const fs = require("fs");
const fsp = require("fs/promises");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const ENV_PATH = path.join(ROOT_DIR, ".env");
const POLL_INTERVAL_MS = 1200;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const index = line.indexOf("=");
    if (index === -1) {
      continue;
    }

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(ENV_PATH);

function hashPassword(password) {
  return crypto.createHash("sha256").update(password, "utf8").digest("hex");
}

if (process.argv[2] === "--hash-password") {
  const password = process.argv[3];
  if (!password) {
    console.error('Usage: npm run hash-password -- "your-password"');
    process.exit(1);
  }
  console.log(hashPassword(password));
  process.exit(0);
}

const config = {
  vaultPath: process.env.VAULT_PATH ? path.resolve(process.env.VAULT_PATH) : "",
  host: process.env.APP_HOST || "0.0.0.0",
  port: Number(process.env.APP_PORT || "3210"),
  passwordHash: process.env.APP_PASSWORD_HASH || "",
  password: process.env.APP_PASSWORD || "",
  sessionTtlMs: Number(process.env.SESSION_TTL_HOURS || "24") * 60 * 60 * 1000
};

if (!config.vaultPath) {
  console.error("Missing VAULT_PATH. Add it to .env or your shell environment.");
  process.exit(1);
}

if (!config.passwordHash && !config.password) {
  console.error("Set APP_PASSWORD_HASH or APP_PASSWORD before starting the server.");
  process.exit(1);
}

if (!fs.existsSync(config.vaultPath)) {
  console.error(`Vault path does not exist: ${config.vaultPath}`);
  process.exit(1);
}

const effectivePasswordHash = config.passwordHash || hashPassword(config.password);
const sessions = new Map();
const sseClients = new Set();
let vaultSnapshot = new Map();
let snapshotReady = false;

function createSession() {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + config.sessionTtlMs);
  return token;
}

function isSessionValid(token) {
  if (!token) {
    return false;
  }
  const expiresAt = sessions.get(token);
  if (!expiresAt) {
    return false;
  }
  if (expiresAt < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function touchSession(token) {
  if (isSessionValid(token)) {
    sessions.set(token, Date.now() + config.sessionTtlMs);
  }
}

function removeExpiredSessions() {
  const now = Date.now();
  for (const [token, expiresAt] of sessions.entries()) {
    if (expiresAt < now) {
      sessions.delete(token);
    }
  }
}

function parseCookies(header) {
  const cookies = {};
  if (!header) {
    return cookies;
  }

  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    cookies[name] = decodeURIComponent(rest.join("=") || "");
  }
  return cookies;
}

function getSessionToken(req) {
  return parseCookies(req.headers.cookie || "").obsidian_session || "";
}

function setCookie(res, name, value, maxAgeSeconds) {
  const cookie = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
  res.setHeader("Set-Cookie", cookie);
}

function clearCookie(res, name) {
  res.setHeader("Set-Cookie", `${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendText(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendNoContent(res, statusCode = 204) {
  res.writeHead(statusCode, { "Cache-Control": "no-store" });
  res.end();
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJsonBody(req) {
  const body = await readRequestBody(req);
  if (!body) {
    return {};
  }
  return JSON.parse(body);
}

function normalizeRelativePath(inputPath) {
  if (typeof inputPath !== "string") {
    throw new Error("Path must be a string.");
  }

  const normalized = inputPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized === ".") {
    throw new Error("Path is required.");
  }
  if (normalized.includes("\0")) {
    throw new Error("Invalid path.");
  }
  return normalized;
}

function resolveVaultPath(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const absolutePath = path.resolve(config.vaultPath, normalized);
  const relativeToVault = path.relative(config.vaultPath, absolutePath);
  if (relativeToVault.startsWith("..") || path.isAbsolute(relativeToVault)) {
    throw new Error("Path must stay inside the vault.");
  }
  return { normalized: relativeToVault.replace(/\\/g, "/"), absolutePath };
}

function toVaultRelative(absolutePath) {
  return path.relative(config.vaultPath, absolutePath).replace(/\\/g, "/");
}

async function ensureParentDirectory(filePath) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
}

async function atomicWriteFile(filePath, content) {
  await ensureParentDirectory(filePath);
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(tempPath, content, "utf8");
  await fsp.rename(tempPath, filePath);
}

function isMarkdownFile(filePath) {
  return filePath.toLowerCase().endsWith(".md");
}

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};

function getMimeType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function htmlEscape(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineMarkdown(text) {
  let result = htmlEscape(text);
  result = result.replace(/`([^`]+)`/g, "<code>$1</code>");
  result = result.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_, target, label) => {
    const href = encodeURIComponent(target.trim());
    return `<a href="#" data-note-link="${href}">${htmlEscape(label.trim())}</a>`;
  });
  result = result.replace(/\[\[([^\]]+)\]\]/g, (_, target) => {
    const cleanTarget = target.trim();
    const href = encodeURIComponent(cleanTarget);
    return `<a href="#" data-note-link="${href}">${htmlEscape(cleanTarget)}</a>`;
  });
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  result = result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return result;
}

function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const output = [];
  let inList = false;
  let inCodeBlock = false;
  const paragraphBuffer = [];

  function flushParagraph() {
    if (paragraphBuffer.length > 0) {
      output.push(`<p>${inlineMarkdown(paragraphBuffer.join(" "))}</p>`);
      paragraphBuffer.length = 0;
    }
  }

  function closeList() {
    if (inList) {
      output.push("</ul>");
      inList = false;
    }
  }

  for (const line of lines) {
    if (line.startsWith("```")) {
      flushParagraph();
      closeList();
      if (inCodeBlock) {
        output.push("</code></pre>");
      } else {
        output.push("<pre><code>");
      }
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      output.push(`${htmlEscape(line)}\n`);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      closeList();
      const level = headingMatch[1].length;
      output.push(`<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      closeList();
      output.push(`<blockquote>${inlineMarkdown(quoteMatch[1])}</blockquote>`);
      continue;
    }

    const listMatch = line.match(/^[-*]\s+(.*)$/);
    if (listMatch) {
      flushParagraph();
      if (!inList) {
        output.push("<ul>");
        inList = true;
      }
      output.push(`<li>${inlineMarkdown(listMatch[1])}</li>`);
      continue;
    }

    closeList();
    paragraphBuffer.push(line.trim());
  }

  flushParagraph();
  closeList();
  if (inCodeBlock) {
    output.push("</code></pre>");
  }

  return output.join("\n");
}

async function listVaultEntries() {
  const root = {
    name: path.basename(config.vaultPath),
    path: "",
    type: "folder",
    children: []
  };

  async function walk(dirPath, targetNode) {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    const children = [];

    for (const entry of entries) {
      const absolutePath = path.join(dirPath, entry.name);
      const relativePath = toVaultRelative(absolutePath);

      if (entry.isDirectory()) {
        const folderNode = {
          name: entry.name,
          path: relativePath,
          type: "folder",
          children: []
        };
        await walk(absolutePath, folderNode);
        children.push(folderNode);
      } else if (entry.isFile() && isMarkdownFile(entry.name)) {
        children.push({
          name: entry.name,
          path: relativePath,
          type: "note"
        });
      }
    }

    children.sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "folder" ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });

    targetNode.children = children;
  }

  await walk(config.vaultPath, root);
  return root;
}

async function getMarkdownFiles() {
  const files = [];

  async function walk(dirPath) {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile() && isMarkdownFile(entry.name)) {
        files.push(absolutePath);
      }
    }
  }

  await walk(config.vaultPath);
  return files;
}

async function buildVaultSnapshot() {
  const nextSnapshot = new Map();

  async function walk(dirPath) {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(dirPath, entry.name);
      const relativePath = toVaultRelative(absolutePath);
      if (entry.isDirectory()) {
        nextSnapshot.set(relativePath, { type: "folder" });
        await walk(absolutePath);
      } else if (entry.isFile()) {
        const stats = await fsp.stat(absolutePath);
        nextSnapshot.set(relativePath, {
          type: "file",
          size: stats.size,
          mtimeMs: stats.mtimeMs
        });
      }
    }
  }

  await walk(config.vaultPath);
  return nextSnapshot;
}

function broadcastEvent(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    res.write(payload);
  }
}

async function pollVaultChanges() {
  try {
    const nextSnapshot = await buildVaultSnapshot();

    if (!snapshotReady) {
      vaultSnapshot = nextSnapshot;
      snapshotReady = true;
      return;
    }

    const changedPaths = [];
    const deletedPaths = [];

    for (const [relativePath, nextEntry] of nextSnapshot.entries()) {
      const previousEntry = vaultSnapshot.get(relativePath);
      if (!previousEntry) {
        changedPaths.push(relativePath);
        continue;
      }
      if (
        previousEntry.type !== nextEntry.type ||
        previousEntry.size !== nextEntry.size ||
        previousEntry.mtimeMs !== nextEntry.mtimeMs
      ) {
        changedPaths.push(relativePath);
      }
    }

    for (const relativePath of vaultSnapshot.keys()) {
      if (!nextSnapshot.has(relativePath)) {
        deletedPaths.push(relativePath);
      }
    }

    if (changedPaths.length > 0 || deletedPaths.length > 0) {
      broadcastEvent({
        type: "vault_changed",
        changedPaths,
        deletedPaths,
        timestamp: Date.now()
      });
    }

    vaultSnapshot = nextSnapshot;
  } catch (error) {
    console.error("Vault polling failed:", error);
  }
}

async function searchNotes(query) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const files = await getMarkdownFiles();
  const results = [];

  for (const absolutePath of files) {
    const relativePath = toVaultRelative(absolutePath);
    const content = await fsp.readFile(absolutePath, "utf8");
    const lowerContent = content.toLowerCase();
    const lowerName = path.basename(relativePath).toLowerCase();
    const fileNameMatch = lowerName.includes(normalizedQuery);
    const contentIndex = lowerContent.indexOf(normalizedQuery);

    if (!fileNameMatch && contentIndex === -1) {
      continue;
    }

    let snippet = "";
    if (contentIndex !== -1) {
      const start = Math.max(0, contentIndex - 40);
      const end = Math.min(content.length, contentIndex + normalizedQuery.length + 80);
      snippet = content.slice(start, end).replace(/\s+/g, " ").trim();
    }

    results.push({
      path: relativePath,
      name: path.basename(relativePath),
      snippet
    });
  }

  return results.slice(0, 50);
}

function serveStaticFile(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const normalized = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.join(PUBLIC_DIR, normalized);

  if (!absolutePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(absolutePath, (error, data) => {
    if (error) {
      sendText(res, 404, "Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": getMimeType(absolutePath),
      "Content-Length": data.length,
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}

function requireAuth(req, res) {
  const token = getSessionToken(req);
  if (!isSessionValid(token)) {
    sendJson(res, 401, { error: "Unauthorized" });
    return false;
  }
  touchSession(token);
  return true;
}

async function handleApi(req, res, requestUrl) {
  const pathname = requestUrl.pathname;

  if (pathname === "/api/auth/status" && req.method === "GET") {
    sendJson(res, 200, { authenticated: isSessionValid(getSessionToken(req)) });
    return;
  }

  if (pathname === "/api/auth/login" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      if (hashPassword(body.password || "") !== effectivePasswordHash) {
        sendJson(res, 401, { error: "Invalid password" });
        return;
      }

      const token = createSession();
      setCookie(res, "obsidian_session", token, Math.floor(config.sessionTtlMs / 1000));
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 400, { error: "Invalid request body" });
    }
    return;
  }

  if (pathname === "/api/auth/logout" && req.method === "POST") {
    sessions.delete(getSessionToken(req));
    clearCookie(res, "obsidian_session");
    sendJson(res, 200, { ok: true });
    return;
  }

  if (!requireAuth(req, res)) {
    return;
  }

  if (pathname === "/api/config" && req.method === "GET") {
    sendJson(res, 200, {
      vaultName: path.basename(config.vaultPath),
      liveUpdateIntervalMs: POLL_INTERVAL_MS
    });
    return;
  }

  if (pathname === "/api/notes" && req.method === "GET") {
    const tree = await listVaultEntries();
    sendJson(res, 200, { tree });
    return;
  }

  if (pathname === "/api/note" && req.method === "GET") {
    try {
      const notePath = requestUrl.searchParams.get("path") || "";
      const { normalized, absolutePath } = resolveVaultPath(notePath);
      const content = await fsp.readFile(absolutePath, "utf8");
      const stats = await fsp.stat(absolutePath);
      sendJson(res, 200, {
        path: normalized,
        name: path.basename(normalized),
        content,
        html: markdownToHtml(content),
        updatedAt: stats.mtimeMs
      });
    } catch (error) {
      sendJson(res, 404, { error: error.message });
    }
    return;
  }

  if (pathname === "/api/note" && req.method === "PUT") {
    try {
      const body = await readJsonBody(req);
      const { normalized, absolutePath } = resolveVaultPath(body.path || "");
      const content = String(body.content ?? "");
      await atomicWriteFile(absolutePath, content);
      sendJson(res, 200, {
        ok: true,
        path: normalized,
        html: markdownToHtml(content),
        updatedAt: Date.now()
      });
    } catch (error) {
      console.error("Note save failed:", error);
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (pathname === "/api/note" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const notePath = String(body.path || "");
      const { normalized, absolutePath } = resolveVaultPath(notePath);
      if (!isMarkdownFile(normalized)) {
        throw new Error("New note path must end with .md");
      }
      if (fs.existsSync(absolutePath)) {
        throw new Error("A note already exists at that path.");
      }
      await atomicWriteFile(absolutePath, String(body.content ?? ""));
      sendJson(res, 201, { ok: true, path: normalized });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (pathname === "/api/note" && req.method === "DELETE") {
    try {
      const notePath = requestUrl.searchParams.get("path") || "";
      const { absolutePath } = resolveVaultPath(notePath);
      await fsp.unlink(absolutePath);
      sendNoContent(res);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (pathname === "/api/note/rename" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const from = resolveVaultPath(body.from || "");
      const to = resolveVaultPath(body.to || "");
      if (!isMarkdownFile(to.normalized)) {
        throw new Error("Renamed note must end with .md");
      }
      await ensureParentDirectory(to.absolutePath);
      await fsp.rename(from.absolutePath, to.absolutePath);
      sendJson(res, 200, { ok: true, path: to.normalized });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (pathname === "/api/folder" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const { normalized, absolutePath } = resolveVaultPath(body.path || "");
      await fsp.mkdir(absolutePath, { recursive: true });
      sendJson(res, 201, { ok: true, path: normalized });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (pathname === "/api/folder/rename" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const from = resolveVaultPath(body.from || "");
      const to = resolveVaultPath(body.to || "");
      await ensureParentDirectory(to.absolutePath);
      await fsp.rename(from.absolutePath, to.absolutePath);
      sendJson(res, 200, { ok: true, path: to.normalized });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (pathname === "/api/folder" && req.method === "DELETE") {
    try {
      const folderPath = requestUrl.searchParams.get("path") || "";
      const { absolutePath } = resolveVaultPath(folderPath);
      await fsp.rm(absolutePath, { recursive: true, force: false });
      sendNoContent(res);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (pathname === "/api/search" && req.method === "GET") {
    const query = requestUrl.searchParams.get("q") || "";
    const results = await searchNotes(query);
    sendJson(res, 200, { results });
    return;
  }

  if (pathname === "/api/file" && req.method === "GET") {
    try {
      const filePath = requestUrl.searchParams.get("path") || "";
      const { absolutePath } = resolveVaultPath(filePath);
      const stats = await fsp.stat(absolutePath);
      if (!stats.isFile()) {
        throw new Error("Not a file");
      }
      res.writeHead(200, {
        "Content-Type": getMimeType(absolutePath),
        "Content-Length": stats.size,
        "Cache-Control": "no-store"
      });
      fs.createReadStream(absolutePath).pipe(res);
    } catch (error) {
      sendJson(res, 404, { error: error.message });
    }
    return;
  }

  if (pathname === "/api/events" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive"
    });
    res.write(`data: ${JSON.stringify({ type: "connected", timestamp: Date.now() })}\n\n`);
    sseClients.add(res);
    req.on("close", () => {
      sseClients.delete(res);
    });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

const server = http.createServer(async (req, res) => {
  try {
    removeExpiredSessions();
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (requestUrl.pathname.startsWith("/api/")) {
      await handleApi(req, res, requestUrl);
      return;
    }

    serveStaticFile(req, res, requestUrl.pathname);
  } catch (error) {
    console.error("Unhandled server error:", error);
    sendJson(res, 500, { error: "Internal server error" });
  }
});

setInterval(() => {
  void pollVaultChanges();
}, POLL_INTERVAL_MS);

void pollVaultChanges();

server.listen(config.port, config.host, () => {
  console.log(`Vault: ${config.vaultPath}`);
  console.log(`Listening on http://${config.host}:${config.port}`);
});
