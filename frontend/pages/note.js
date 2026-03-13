import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (response.status === 204) {
    return null;
  }

  const isJson = (response.headers.get("content-type") || "").includes("application/json");
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof payload === "string" ? payload : payload.error || "Request failed";
    throw new Error(message);
  }

  return payload;
}

function flattenNotes(node, results = []) {
  if (node.type === "note") {
    results.push(node.path);
    return results;
  }

  if (!node.children) {
    return results;
  }

  for (const child of node.children) {
    flattenNotes(child, results);
  }

  return results;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function serializeInline(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || "";
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const element = node;
  const text = Array.from(element.childNodes).map(serializeInline).join("");

  switch (element.tagName) {
    case "INPUT":
      return "";
    case "STRONG":
    case "B":
      return `**${text}**`;
    case "EM":
    case "I":
      return `*${text}*`;
    case "CODE":
      return `\`${text}\``;
    case "A": {
      const noteLink = element.getAttribute("data-note-link");
      if (noteLink) {
        return `[[${decodeURIComponent(noteLink)}]]`;
      }
      const href = element.getAttribute("href") || "";
      return `[${text}](${href})`;
    }
    case "BR":
      return "\n";
    default:
      return text;
  }
}

function serializeBlock(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.trim();
    return text ? `${text}\n\n` : "";
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const element = node;
  const inlineText = Array.from(element.childNodes).map(serializeInline).join("").trim();

  switch (element.tagName) {
    case "H1":
      return `# ${inlineText}\n\n`;
    case "H2":
      return `## ${inlineText}\n\n`;
    case "H3":
      return `### ${inlineText}\n\n`;
    case "BLOCKQUOTE":
      return inlineText
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")
        .concat("\n\n");
    case "UL": {
      const items = Array.from(element.children)
        .filter((child) => child.tagName === "LI")
        .map((child) => {
          const checkbox = child.querySelector('input[type="checkbox"]');
          const content = Array.from(child.childNodes)
            .filter((entry) => entry !== checkbox)
            .map(serializeInline)
            .join("")
            .trim();
          if (checkbox) {
            return checkbox.checked ? `- [x] ${content}` : `- [ ] ${content}`;
          }
          return `- ${content}`;
        })
        .join("\n");
      return items ? `${items}\n\n` : "";
    }
    case "OL": {
      const items = Array.from(element.children)
        .filter((child) => child.tagName === "LI")
        .map(
          (child, index) =>
            `${index + 1}. ${Array.from(child.childNodes).map(serializeInline).join("").trim()}`
        )
        .join("\n");
      return items ? `${items}\n\n` : "";
    }
    case "PRE": {
      const code = element.textContent || "";
      return `\`\`\`\n${code.replace(/\n$/, "")}\n\`\`\`\n\n`;
    }
    case "P":
    case "DIV":
      return inlineText ? `${inlineText}\n\n` : "";
    default:
      return inlineText ? `${inlineText}\n\n` : "";
  }
}

function htmlToMarkdown(rootElement) {
  return Array.from(rootElement.childNodes)
    .map(serializeBlock)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

function normalizeLinkTargets(rootElement) {
  rootElement.querySelectorAll("a").forEach((link) => {
    const href = link.getAttribute("href") || "";
    const noteMatch = href.match(/\/note\?path=(.+)$/);
    if (noteMatch) {
      link.setAttribute("data-note-link", noteMatch[1]);
      link.removeAttribute("href");
    }
  });
}

function parseFrontmatter(markdown) {
  const normalized = markdown.replace(/\r/g, "");
  if (!normalized.startsWith("---\n")) {
    return { properties: [], body: normalized };
  }

  const lines = normalized.split("\n");
  let endIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === "---") {
      endIndex = index;
      break;
    }
  }

  if (endIndex === -1) {
    return { properties: [], body: normalized };
  }

  const properties = [];
  let currentListProperty = null;

  for (const line of lines.slice(1, endIndex)) {
    const listMatch = line.match(/^\s*-\s+(.*)$/);
    if (listMatch && currentListProperty) {
      currentListProperty.items.push(listMatch[1].trim());
      continue;
    }

    const propertyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!propertyMatch) {
      currentListProperty = null;
      continue;
    }

    const key = propertyMatch[1].trim();
    const rawValue = propertyMatch[2];
    if (rawValue) {
      properties.push({ key, type: "text", value: rawValue.trim() });
      currentListProperty = null;
      continue;
    }

    currentListProperty = { key, type: "list", items: [] };
    properties.push(currentListProperty);
  }

  const body = lines.slice(endIndex + 1).join("\n").replace(/^\n+/, "");
  const legacyLine = flattenPropertiesToLegacyLine(properties);

  return {
    properties,
    body:
      legacyLine && body.startsWith(legacyLine)
        ? body.slice(legacyLine.length).replace(/^\s+/, "")
        : body
  };
}

function serializeFrontmatter(properties) {
  if (!Array.isArray(properties) || properties.length === 0) {
    return "";
  }

  const lines = ["---"];
  for (const property of properties) {
    if (!property?.key) {
      continue;
    }

    if (property.type === "list") {
      lines.push(`${property.key}:`);
      for (const item of property.items || []) {
        lines.push(`  - ${String(item ?? "").trim()}`);
      }
      continue;
    }

    lines.push(`${property.key}: ${String(property.value ?? "").trim()}`);
  }
  lines.push("---");
  return `${lines.join("\n")}\n\n`;
}

function flattenPropertiesToLegacyLine(properties) {
  if (!Array.isArray(properties) || properties.length === 0) {
    return "";
  }

  const parts = ["---"];
  for (const property of properties) {
    if (!property?.key) {
      continue;
    }

    if (property.type === "list") {
      parts.push(`${property.key}:`);
      for (const item of property.items || []) {
        parts.push(`- ${String(item ?? "").trim()}`);
      }
      continue;
    }

    parts.push(`${property.key}: ${String(property.value ?? "").trim()}`);
  }
  parts.push("---");
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function composeNoteMarkdown(properties, bodyMarkdown) {
  const frontmatter = serializeFrontmatter(properties);
  return `${frontmatter}${bodyMarkdown}`.trimEnd();
}

function formatPropertyValue(value) {
  if (typeof value !== "string") {
    return value;
  }

  const isoDateMatch = value.match(
    /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/
  );
  if (!isoDateMatch) {
    return value;
  }

  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: value.includes("T") || value.includes(" ") ? "numeric" : undefined,
    minute: value.includes("T") || value.includes(" ") ? "2-digit" : undefined
  }).format(parsed);
}

function renderInlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/\[\[([^\]]+)\]\]/g, (_, target) => {
      const trimmed = target.trim();
      return `<a data-note-link="${encodeURIComponent(trimmed)}">${escapeHtml(trimmed)}</a>`;
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
      const safeHref = escapeHtml(href);
      return `<a href="${safeHref}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
    })
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, "$1<em>$2</em>");
}

function markdownPatternPresent(text) {
  return /(\*\*[^*\n]+\*\*|(^|[\s(])\*[^*\n]+\*(?=$|[\s).,!?:;])|`[^`\n]+`|\[[^\]]+\]\([^)]+\)|\[\[[^\]]+\]\])/.test(
    text
  );
}

function placeCaretAtStart(node) {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function placeCaretAtEnd(node) {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function keepCaretVisible(rootElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }

  const range = selection.getRangeAt(0).cloneRange();
  let rect = range.getBoundingClientRect();
  if (!rect || (rect.height === 0 && rect.width === 0)) {
    let targetNode = range.startContainer;
    if (targetNode.nodeType === Node.TEXT_NODE) {
      targetNode = targetNode.parentNode;
    }
    if (targetNode && typeof targetNode.getBoundingClientRect === "function") {
      rect = targetNode.getBoundingClientRect();
    }
  }

  if (!rect) {
    return;
  }

  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  const topSafeZone = 88;
  const bottomSafeZone = 180;
  const currentScroll = window.scrollY || window.pageYOffset || 0;

  if (rect.bottom > viewportHeight - bottomSafeZone) {
    const delta = rect.bottom - (viewportHeight - bottomSafeZone);
    window.scrollTo({
      top: currentScroll + delta,
      behavior: "auto"
    });
    return;
  }

  if (rect.top < topSafeZone) {
    const delta = topSafeZone - rect.top;
    window.scrollTo({
      top: Math.max(0, currentScroll - delta),
      behavior: "auto"
    });
    return;
  }

  if (rootElement && typeof rootElement.scrollIntoView === "function" && !rootElement.textContent) {
    rootElement.scrollIntoView({
      block: "start",
      inline: "nearest"
    });
  }
}

function currentBlockElement(rootElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  let node = selection.anchorNode;
  while (node && node !== rootElement) {
    if (
      node.nodeType === Node.ELEMENT_NODE &&
      ["P", "DIV", "LI", "H1", "H2", "H3", "BLOCKQUOTE"].includes(node.tagName)
    ) {
      return node;
    }
    node = node.parentNode;
  }

  return null;
}

function isEmptyStructuredItem(block) {
  if (!block || block.tagName !== "LI") {
    return false;
  }

  return Array.from(block.childNodes).every((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return !(node.textContent || "").trim();
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return true;
    }

    if (node.tagName === "INPUT") {
      return true;
    }

    if (node.tagName === "BR") {
      return true;
    }

    return !(node.textContent || "").trim();
  });
}

function isEffectivelyEmptyBlock(block) {
  if (!block || block.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }

  if (block.tagName === "LI") {
    return isEmptyStructuredItem(block);
  }

  return Array.from(block.childNodes).every((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return !(node.textContent || "").trim();
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return true;
    }

    if (node.tagName === "BR") {
      return true;
    }

    return !(node.textContent || "").trim();
  });
}

function applyMarkdownShortcut(rootElement) {
  const block = currentBlockElement(rootElement);
  if (!block) {
    return false;
  }

  const text = block.textContent || "";
  const parent = block.parentNode;
  if (!parent) {
    return false;
  }

  const bulletMatch = text.match(/^[-*]\s+(.*)$/);
  if (text === "- " || text === "* " || bulletMatch) {
    const list = document.createElement("ul");
    const item = document.createElement("li");
    const itemText = bulletMatch?.[1] || "";
    if (itemText) {
      item.textContent = itemText;
    } else {
      item.appendChild(document.createElement("br"));
    }
    list.appendChild(item);
    parent.replaceChild(list, block);
    if (itemText) {
      placeCaretAtEnd(item);
    } else {
      placeCaretAtStart(item);
    }
    return true;
  }

  const checkboxMatch = text.match(/^-\s\[( |x)\]\s+(.*)$/i);
  if (checkboxMatch) {
    const list = document.createElement("ul");
    const item = document.createElement("li");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.disabled = true;
    checkbox.checked = checkboxMatch[1].toLowerCase() === "x";
    item.appendChild(checkbox);
    item.append(" ");
    item.insertAdjacentHTML("beforeend", renderInlineMarkdown(checkboxMatch[2] || ""));
    list.appendChild(item);
    parent.replaceChild(list, block);
    placeCaretAtEnd(item);
    normalizeLinkTargets(item);
    return true;
  }

  const quoteMatch = text.match(/^>\s+(.*)$/);
  if (text === "> " || quoteMatch) {
    const quote = document.createElement("blockquote");
    const quoteText = quoteMatch?.[1] || "";
    if (quoteText) {
      quote.textContent = quoteText;
    } else {
      quote.appendChild(document.createElement("br"));
    }
    parent.replaceChild(quote, block);
    if (quoteText) {
      placeCaretAtEnd(quote);
    } else {
      placeCaretAtStart(quote);
    }
    return true;
  }

  const orderedMatch = text.match(/^\d+\.\s+(.*)$/);
  if (orderedMatch) {
    const list = document.createElement("ol");
    const item = document.createElement("li");
    const itemText = orderedMatch[1] || "";
    if (itemText) {
      item.innerHTML = renderInlineMarkdown(itemText);
    } else {
      item.appendChild(document.createElement("br"));
    }
    list.appendChild(item);
    parent.replaceChild(list, block);
    normalizeLinkTargets(item);
    if (itemText) {
      placeCaretAtEnd(item);
    } else {
      placeCaretAtStart(item);
    }
    return true;
  }

  const headingMatch = text.match(/^(#{1,3})\s+(.*)$/) || text.match(/^(#{1,3}) $/);
  if (headingMatch) {
    const level = headingMatch[1].length;
    const heading = document.createElement(`h${level}`);
    const headingText = headingMatch[2] || "";
    if (headingText) {
      heading.textContent = headingText;
    } else {
      heading.appendChild(document.createElement("br"));
    }
    parent.replaceChild(heading, block);
    if (headingText) {
      placeCaretAtEnd(heading);
    } else {
      placeCaretAtStart(heading);
    }
    return true;
  }

  const fenceMatch = text.match(/^```([\w-]+)?$/);
  if (fenceMatch) {
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    if (fenceMatch[1]) {
      code.setAttribute("data-language", fenceMatch[1]);
    }
    code.appendChild(document.createElement("br"));
    pre.appendChild(code);
    parent.replaceChild(pre, block);
    placeCaretAtStart(code);
    return true;
  }

  if (markdownPatternPresent(text) && block.tagName !== "PRE") {
    block.innerHTML = renderInlineMarkdown(text);
    normalizeLinkTargets(block);
    placeCaretAtEnd(block);
    return true;
  }

  return false;
}

function revertStructuredBlockToMarkdown(rootElement) {
  const block = currentBlockElement(rootElement);
  if (!block || !block.parentNode) {
    return false;
  }

  if (isEmptyStructuredItem(block)) {
    const list = block.parentNode;
    const paragraph = document.createElement("p");
    const checkbox = block.querySelector('input[type="checkbox"]');

    if (checkbox) {
      paragraph.textContent = checkbox.checked ? "- [x] " : "- [ ] ";
    } else if (list?.tagName === "OL") {
      paragraph.textContent = "1. ";
    } else {
      paragraph.textContent = "- ";
    }

    if (list && list.children.length === 1 && list.parentNode) {
      list.parentNode.replaceChild(paragraph, list);
    } else {
      list?.removeChild(block);
      list?.parentNode?.insertBefore(paragraph, list?.nextSibling || null);
    }

    placeCaretAtEnd(paragraph);
    return true;
  }

  if (!isEffectivelyEmptyBlock(block)) {
    return false;
  }

  const paragraph = document.createElement("p");

  if (block.tagName === "BLOCKQUOTE") {
    paragraph.textContent = "> ";
  } else if (block.tagName === "H1") {
    paragraph.textContent = "# ";
  } else if (block.tagName === "H2") {
    paragraph.textContent = "## ";
  } else if (block.tagName === "H3") {
    paragraph.textContent = "### ";
  } else if (block.tagName === "PRE") {
    const code = block.querySelector("code");
    const language = code?.getAttribute("data-language");
    paragraph.textContent = language ? `\`\`\`${language}` : "```";
  } else {
    return false;
  }

  block.parentNode.replaceChild(paragraph, block);
  placeCaretAtEnd(paragraph);
  return true;

  return false;
}

export default function NotePage() {
  const router = useRouter();
  const { path: notePathQuery } = router.query;
  const [tree, setTree] = useState(null);
  const [notePath, setNotePath] = useState("");
  const [properties, setProperties] = useState([]);
  const [markdownContent, setMarkdownContent] = useState("");
  const [rawMarkdownContent, setRawMarkdownContent] = useState("");
  const [visualHtml, setVisualHtml] = useState("");
  const [status, setStatus] = useState("Connecting...");
  const [loaded, setLoaded] = useState(false);
  const [editorMode, setEditorMode] = useState("visual");
  const [saveRevision, setSaveRevision] = useState(0);
  const pendingSaveRef = useRef(false);
  const dirtyRef = useRef(false);
  const eventSourceRef = useRef(null);
  const visualEditorRef = useRef(null);

  function noteTitle() {
    if (!notePath) {
      return "Loading note...";
    }
    const parts = notePath.split("/");
    return parts[parts.length - 1];
  }

  function syncVisualEditor(nextHtml) {
    const editor = visualEditorRef.current;
    if (!editor) {
      return;
    }
    editor.innerHTML = nextHtml || "<p></p>";
    normalizeLinkTargets(editor);
  }

  async function saveCurrentContent(contentToSave, options = {}) {
    const { syncVisual = editorMode !== "visual" } = options;

    pendingSaveRef.current = true;
    setStatus("Saving...");
    try {
      const payload = await api("/api/note", {
        method: "PUT",
        body: JSON.stringify({
          path: notePath,
          content: contentToSave
        })
      });
      const parsed = parseFrontmatter(contentToSave);
      setMarkdownContent(parsed.body);
      setRawMarkdownContent(contentToSave);
      setProperties(payload.properties || []);
      if (syncVisual) {
        setVisualHtml(payload.bodyHtml || payload.html);
        if (editorMode === "visual") {
          syncVisualEditor(payload.bodyHtml || payload.html);
        }
      }
      dirtyRef.current = false;
      setStatus("Live sync connected");
      return payload;
    } catch (error) {
      setStatus(`Save failed: ${error.message}`);
      throw error;
    } finally {
      pendingSaveRef.current = false;
    }
  }

  useEffect(() => {
    if (!router.isReady) {
      return;
    }

    let active = true;

    async function boot() {
      try {
        const auth = await api("/api/auth/status");
        if (!auth.authenticated) {
          router.replace("/login");
          return;
        }

        if (typeof notePathQuery !== "string" || !notePathQuery) {
          router.replace("/app");
          return;
        }

        const [notesPayload, notePayload] = await Promise.all([
          api("/api/notes"),
          api(`/api/note?path=${encodeURIComponent(notePathQuery)}`)
        ]);

        if (!active) {
          return;
        }

        setTree(notesPayload.tree);
        setNotePath(notePayload.path);
        const parsed = parseFrontmatter(notePayload.content);
        setMarkdownContent(parsed.body);
        setRawMarkdownContent(notePayload.content);
        setProperties(notePayload.properties || parsed.properties);
        setVisualHtml(notePayload.bodyHtml || notePayload.html);
        setStatus("Live sync connected");
        setLoaded(true);
      } catch {
        if (active) {
          router.replace("/login");
        }
      }
    }

    void boot();

    return () => {
      active = false;
    };
  }, [notePathQuery, router, router.isReady]);

  useEffect(() => {
    if (!loaded || editorMode !== "visual") {
      return;
    }
    syncVisualEditor(visualHtml);
  }, [editorMode, loaded, visualHtml]);

  useEffect(() => {
    if (!loaded) {
      return;
    }

    const events = new EventSource("/api/events", { withCredentials: true });
    eventSourceRef.current = events;
    events.onopen = () => setStatus("Live sync connected");
    events.onerror = () => setStatus("Live sync reconnecting...");
    events.onmessage = async (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type !== "vault_changed") {
          return;
        }

        if (payload.deletedPaths?.includes(notePath)) {
          router.replace("/app");
          return;
        }

        if (
          payload.changedPaths?.includes(notePath) &&
          !dirtyRef.current &&
          !pendingSaveRef.current
        ) {
          const nextNote = await api(`/api/note?path=${encodeURIComponent(notePath)}`);
          const parsed = parseFrontmatter(nextNote.content);
          setMarkdownContent(parsed.body);
          setRawMarkdownContent(nextNote.content);
          setProperties(nextNote.properties || parsed.properties);
          setVisualHtml(nextNote.bodyHtml || nextNote.html);
          if (editorMode === "visual") {
            syncVisualEditor(nextNote.bodyHtml || nextNote.html);
          }
        }

        const notesPayload = await api("/api/notes");
        setTree(notesPayload.tree);
      } catch {
        setStatus("Live sync error");
      }
    };

    return () => {
      events.close();
      eventSourceRef.current = null;
    };
  }, [editorMode, loaded, notePath, router]);

  useEffect(() => {
    if (!loaded || !notePath || !dirtyRef.current) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const nextContent =
        editorMode === "visual"
          ? composeNoteMarkdown(properties, markdownContent)
          : rawMarkdownContent;
      void saveCurrentContent(nextContent, { syncVisual: false });
    }, 500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [editorMode, loaded, markdownContent, notePath, properties, rawMarkdownContent, saveRevision]);

  async function switchMode(nextMode) {
    if (nextMode === editorMode) {
      return;
    }

    if (editorMode === "visual" && visualEditorRef.current) {
      const nextBodyMarkdown = htmlToMarkdown(visualEditorRef.current);
      const nextMarkdown = composeNoteMarkdown(properties, nextBodyMarkdown);
      setMarkdownContent(nextBodyMarkdown);
      setRawMarkdownContent(nextMarkdown);
      if (dirtyRef.current) {
        await saveCurrentContent(nextMarkdown);
      }
    }

    if (editorMode === "markdown" && dirtyRef.current) {
      await saveCurrentContent(rawMarkdownContent);
    }

    if (nextMode === "visual") {
      const parsed = parseFrontmatter(rawMarkdownContent);
      setMarkdownContent(parsed.body);
      setProperties(parsed.properties);
    }

    if (nextMode === "markdown") {
      setRawMarkdownContent(composeNoteMarkdown(properties, markdownContent));
    }

    setEditorMode(nextMode);
  }

  function handleVisualInput() {
    if (!visualEditorRef.current) {
      return;
    }
    if (revertStructuredBlockToMarkdown(visualEditorRef.current)) {
      dirtyRef.current = true;
      setStatus("Editing...");
      const nextBody = htmlToMarkdown(visualEditorRef.current);
      setMarkdownContent(nextBody);
      setRawMarkdownContent(composeNoteMarkdown(properties, nextBody));
      setSaveRevision((value) => value + 1);
      window.requestAnimationFrame(() => keepCaretVisible(visualEditorRef.current));
      return;
    }
    applyMarkdownShortcut(visualEditorRef.current);
    dirtyRef.current = true;
    setStatus("Editing...");
    const nextBody = htmlToMarkdown(visualEditorRef.current);
    setMarkdownContent(nextBody);
    setRawMarkdownContent(composeNoteMarkdown(properties, nextBody));
    setSaveRevision((value) => value + 1);
    window.requestAnimationFrame(() => keepCaretVisible(visualEditorRef.current));
  }

  function handleVisualKeyUp(event) {
    if (!visualEditorRef.current) {
      return;
    }

    if (event.key !== " " && event.key !== "Enter") {
      return;
    }

    if (applyMarkdownShortcut(visualEditorRef.current)) {
      handleVisualInput();
    }
  }

  function handleVisualKeyDown(event) {
    if (event.key !== "Backspace" || !visualEditorRef.current) {
      return;
    }

    if (revertStructuredBlockToMarkdown(visualEditorRef.current)) {
      event.preventDefault();
      handleVisualInput();
    }
  }

  function handleVisualBeforeInput(event) {
    if (event.inputType !== "deleteContentBackward" || !visualEditorRef.current) {
      return;
    }

    if (revertStructuredBlockToMarkdown(visualEditorRef.current)) {
      event.preventDefault();
      handleVisualInput();
    }
  }

  function handleMarkdownChange(event) {
    const nextValue = event.target.value;
    const parsed = parseFrontmatter(nextValue);
    dirtyRef.current = true;
    setStatus("Editing...");
    setRawMarkdownContent(nextValue);
    setMarkdownContent(parsed.body);
    setProperties(parsed.properties);
    setSaveRevision((value) => value + 1);
  }

  function applyCommand(command, value) {
    if (editorMode !== "visual") {
      return;
    }
    visualEditorRef.current?.focus();
    document.execCommand(command, false, value);
    handleVisualInput();
  }

  function insertInlineCode() {
    if (editorMode !== "visual" || !visualEditorRef.current) {
      return;
    }
    visualEditorRef.current.focus();
    document.execCommand("insertHTML", false, "<code>code</code>");
    handleVisualInput();
  }

  function insertCodeBlock() {
    if (editorMode !== "visual" || !visualEditorRef.current) {
      return;
    }
    visualEditorRef.current.focus();
    document.execCommand("insertHTML", false, "<pre><code><br></code></pre>");
    handleVisualInput();
  }

  function onVisualClick(event) {
    const noteLink = event.target.closest("[data-note-link]");
    if (!noteLink || !tree) {
      return;
    }

    event.preventDefault();
    const target = decodeURIComponent(noteLink.getAttribute("data-note-link") || "");
    const nextPath = flattenNotes(tree).find((item) => item.endsWith(target));
    if (nextPath) {
      router.push(`/note?path=${encodeURIComponent(nextPath)}`);
    }
  }

  return (
    <>
      <Head>
        <title>{noteTitle()}</title>
      </Head>
      <section className="note-mobile-screen">
        <header className="note-mobile-header">
          <div className="note-header-toprow">
            <Link href="/app" className="icon-button">Back</Link>
            <div className="note-header-actions">
              <button
                type="button"
                className={editorMode === "visual" ? "chip-button active" : "chip-button"}
                onClick={() => void switchMode("visual")}
              >
                Note
              </button>
              <button
                type="button"
                className={editorMode === "markdown" ? "chip-button active" : "chip-button"}
                onClick={() => void switchMode("markdown")}
              >
                Md
              </button>
            </div>
          </div>
          <div className="note-header-copy">
            <h1>{noteTitle()}</h1>
            <p>{notePath}</p>
          </div>
        </header>

        <main className="note-mobile-body">
          <div className="note-status-row">{status}</div>

          {properties.length > 0 ? (
            <section className="properties-panel">
              <div className="properties-title">Properties</div>
              <div className="properties-card">
                {properties.map((property) => (
                  <div className="property-line" key={property.key}>
                    <div className="property-name">{property.key}</div>
                    <div className="property-rendered-value">
                      {property.type === "list" ? (
                        (property.items || []).map((item) => (
                          <span className="property-pill" key={`${property.key}-${item}`}>
                            {formatPropertyValue(item)}
                          </span>
                        ))
                      ) : (
                        formatPropertyValue(property.value)
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {editorMode === "visual" ? (
          <div
            ref={visualEditorRef}
            className="visual-editor-surface"
            contentEditable
            suppressContentEditableWarning
            onBeforeInput={handleVisualBeforeInput}
            onInput={handleVisualInput}
            onKeyDown={handleVisualKeyDown}
            onKeyUp={handleVisualKeyUp}
            onClick={onVisualClick}
          />
          ) : (
            <textarea
              className="markdown-editor-surface"
              value={rawMarkdownContent}
              onChange={handleMarkdownChange}
            />
          )}
        </main>

        {editorMode === "visual" ? (
          <footer className="mobile-editor-toolbar">
            <button type="button" className="toolbar-button" onClick={() => document.execCommand("undo")}>
              Undo
            </button>
            <button type="button" className="toolbar-button" onClick={() => document.execCommand("redo")}>
              Redo
            </button>
            <button type="button" className="toolbar-button" onClick={() => applyCommand("formatBlock", "<h1>")}>
              H1
            </button>
            <button type="button" className="toolbar-button" onClick={() => applyCommand("formatBlock", "<h2>")}>
              H2
            </button>
            <button type="button" className="toolbar-button" onClick={() => applyCommand("bold")}>
              B
            </button>
            <button type="button" className="toolbar-button" onClick={() => applyCommand("italic")}>
              I
            </button>
            <button type="button" className="toolbar-button" onClick={insertInlineCode}>
              Code
            </button>
            <button type="button" className="toolbar-button" onClick={insertCodeBlock}>
              Block
            </button>
            <button type="button" className="toolbar-button" onClick={() => applyCommand("insertUnorderedList")}>
              List
            </button>
            <button type="button" className="toolbar-button" onClick={() => applyCommand("formatBlock", "<blockquote>")}>
              Quote
            </button>
          </footer>
        ) : null}
      </section>
    </>
  );
}
