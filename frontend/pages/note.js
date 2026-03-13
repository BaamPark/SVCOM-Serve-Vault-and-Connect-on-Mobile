import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import toolConfig from "../config/tools.json";

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

function NoteSidebarTreeNode({ node, currentPath, onOpenNote, depth = 0 }) {
  if (node.type === "note") {
    const isCurrent = node.path === currentPath;
    return (
      <article className={isCurrent ? "tree-note-row tree-note-row-current" : "tree-note-row"}>
        <button type="button" className="tree-note-main" onClick={() => onOpenNote(node.path)}>
          <strong>{node.name}</strong>
          <span>{node.path}</span>
        </button>
      </article>
    );
  }

  const defaultOpen =
    node.path === "" ||
    currentPath === node.path ||
    currentPath.startsWith(`${node.path}/`);
  const [isOpen, setIsOpen] = useState(defaultOpen);

  useEffect(() => {
    if (defaultOpen) {
      setIsOpen(true);
    }
  }, [defaultOpen]);

  return (
    <section className="tree-folder">
      {node.path ? (
        <button
          type="button"
          className="tree-folder-toggle"
          onClick={() => setIsOpen((value) => !value)}
        >
          <span className="tree-folder-caret">{isOpen ? "▾" : "▸"}</span>
          <span className="tree-folder-label">{node.name}</span>
        </button>
      ) : null}
      {isOpen ? (
        <div
          className="tree-folder-children"
          style={{ paddingLeft: node.path ? "0.9rem" : undefined }}
        >
          {(node.children || []).map((child) => (
            <NoteSidebarTreeNode
              key={child.path || child.name}
              node={child}
              currentPath={currentPath}
              depth={node.path ? depth + 1 : depth}
              onOpenNote={onOpenNote}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function resolveVisibleToolIds(preferredIds, hiddenIds, registry) {
  const hidden = new Set(hiddenIds || []);
  const seen = new Set();
  const result = [];

  for (const toolId of preferredIds || []) {
    if (hidden.has(toolId) || seen.has(toolId) || !registry[toolId]) {
      continue;
    }
    seen.add(toolId);
    result.push(toolId);
  }

  return result;
}

function serializeInline(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent || "").replace(/\u200b/g, "");
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const element = node;
  if (element.hasAttribute?.("data-inline-trigger")) {
    return "";
  }
  const text = Array.from(element.childNodes).map(serializeInline).join("");

  switch (element.tagName) {
    case "INPUT":
      return "";
    case "STRONG":
    case "B":
      return `**${text}**`;
    case "MARK":
      return `==${text}==`;
    case "S":
    case "STRIKE":
    case "DEL":
      return `~~${text}~~`;
    case "EM":
    case "I":
      return `*${text}*`;
    case "CODE":
      return `\`${text.replace(/\u200b/g, "")}\``;
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
          const taskContent = child.querySelector(".task-content");
          const content = taskContent
            ? Array.from(taskContent.childNodes).map(serializeInline).join("").trim()
            : Array.from(child.childNodes)
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
    case "HR":
      return `---\n\n`;
    case "TABLE": {
      const rows = Array.from(element.querySelectorAll("tr"));
      if (rows.length === 0) {
        return "";
      }

      const serializedRows = rows
        .map((row) =>
          Array.from(row.children)
            .filter((cell) => ["TH", "TD"].includes(cell.tagName))
            .map((cell) => Array.from(cell.childNodes).map(serializeInline).join("").trim())
        )
        .filter((cells) => cells.length > 0);

      if (serializedRows.length === 0) {
        return "";
      }

      const headerCells = serializedRows[0];
      const separator = headerCells.map(() => "---");
      const lines = [
        `| ${headerCells.join(" | ")} |`,
        `| ${separator.join(" | ")} |`,
        ...serializedRows.slice(1).map((cells) => `| ${cells.join(" | ")} |`)
      ];

      return `${lines.join("\n")}\n\n`;
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

function normalizeInlineCaretBoundaries(rootElement) {
  const inlineSelector = "strong, b, em, i, mark, del, s, strike, a, code, .obsidian-tag";
  rootElement.querySelectorAll(inlineSelector).forEach((element) => {
    if (element.tagName === "CODE" && element.closest("pre")) {
      return;
    }

    const nextSibling = element.nextSibling;
    if (
      nextSibling &&
      nextSibling.nodeType === Node.TEXT_NODE &&
      (nextSibling.textContent || "").startsWith("\u200b")
    ) {
      return;
    }

    element.parentNode?.insertBefore(document.createTextNode("\u200b"), element.nextSibling);
  });
}

function isInlineFormattingElement(element) {
  return Boolean(
    element &&
    element.nodeType === Node.ELEMENT_NODE &&
    (
      ["STRONG", "B", "EM", "I", "MARK", "DEL", "S", "STRIKE", "A", "CODE"].includes(element.tagName) ||
      element.classList?.contains("obsidian-tag")
    ) &&
    !(element.tagName === "CODE" && element.closest("pre"))
  );
}

function endOfNodeRange(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(false);
  return range;
}

function routeTypingOutsideInlineWrapper(rootElement, text) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !text) {
    return false;
  }

  const range = selection.getRangeAt(0);
  if (!range.collapsed || !rootElement.contains(range.startContainer)) {
    return false;
  }

  let node = range.startContainer;
  let inlineAncestor = null;

  if (node.nodeType === Node.TEXT_NODE && (node.textContent || "").includes("\u200b")) {
    const insertionOffset = range.startOffset;
    const nextText = `${node.textContent.slice(0, insertionOffset)}${text}${node.textContent.slice(insertionOffset)}`;
    node.textContent = nextText;
    const nextRange = document.createRange();
    nextRange.setStart(node, insertionOffset + text.length);
    nextRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(nextRange);
    return true;
  }

  if (node.nodeType === Node.TEXT_NODE) {
    node = node.parentNode;
  }

  while (node && node !== rootElement) {
    if (isInlineFormattingElement(node)) {
      inlineAncestor = node;
      break;
    }
    node = node.parentNode;
  }

  if (!inlineAncestor) {
    return false;
  }

  const inlineEnd = endOfNodeRange(inlineAncestor);
  if (range.compareBoundaryPoints(Range.START_TO_START, inlineEnd) !== 0) {
    return false;
  }

  let spacer = inlineAncestor.nextSibling;
  if (!(spacer && spacer.nodeType === Node.TEXT_NODE && (spacer.textContent || "").startsWith("\u200b"))) {
    spacer = document.createTextNode("\u200b");
    inlineAncestor.parentNode.insertBefore(spacer, inlineAncestor.nextSibling);
  }

  spacer.textContent = `\u200b${text}${(spacer.textContent || "").replace(/\u200b/g, "")}`;
  const nextRange = document.createRange();
  nextRange.setStart(spacer, 1 + text.length);
  nextRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(nextRange);
  return true;
}

function syncTaskItemState(taskItem) {
  if (!taskItem) {
    return;
  }

  const checkbox = taskItem.querySelector('input[type="checkbox"]');
  const content = taskItem.querySelector(".task-content");
  if (!checkbox || !content) {
    return;
  }

  taskItem.classList.toggle("task-item-checked", checkbox.checked);
  content.classList.toggle("task-content-checked", checkbox.checked);
}

function createTaskListItem(checked, htmlContent = "task") {
  const item = document.createElement("li");
  item.className = "task-item";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "task-checkbox";
  checkbox.checked = checked;
  checkbox.setAttribute("contenteditable", "false");

  const content = document.createElement("span");
  content.className = "task-content";
  content.innerHTML = htmlContent || "<br>";

  item.appendChild(checkbox);
  item.appendChild(content);
  syncTaskItemState(item);
  return item;
}

function placeCaretInsideTaskContent(taskItem) {
  const content = taskItem?.querySelector(".task-content");
  if (!content) {
    return;
  }

  if (!content.childNodes.length) {
    content.appendChild(document.createElement("br"));
  }
  placeCaretAtEnd(content);
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

  const frontmatterLines = lines.slice(1, endIndex);
  const hasPropertyLine = frontmatterLines.some((line) =>
    /^([A-Za-z0-9_-]+):\s*(.*)$/.test(line)
  );
  if (!hasPropertyLine) {
    return { properties: [], body: normalized };
  }

  const properties = [];
  let currentListProperty = null;

  for (const line of frontmatterLines) {
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
    .replace(/(^|[\s(])#([A-Za-z0-9_/-]+)/g, '$1<span class="obsidian-tag">#$2</span>')
    .replace(/\[\[([^\]]+)\]\]/g, (_, target) => {
      const trimmed = target.trim();
      return `<a data-note-link="${encodeURIComponent(trimmed)}">${escapeHtml(trimmed)}</a>`;
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
      const safeHref = escapeHtml(href);
      return `<a href="${safeHref}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
    })
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/==([^=\n]+)==/g, "<mark>$1</mark>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, "$1<em>$2</em>");
}

function parseTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) {
    return null;
  }

  const normalized = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells = normalized.split("|").map((cell) => cell.trim());
  return cells.length > 1 ? cells : null;
}

function isTableSeparatorRow(line, expectedColumns) {
  const cells = parseTableRow(line);
  if (!cells || cells.length !== expectedColumns) {
    return false;
  }

  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderMarkdownBodyToHtml(markdown) {
  const lines = markdown.split("\n");
  const output = [];
  let inList = false;
  let inCodeBlock = false;
  const paragraphBuffer = [];

  function flushParagraph() {
    if (paragraphBuffer.length > 0) {
      output.push(`<p>${renderInlineMarkdown(paragraphBuffer.join(" "))}</p>`);
      paragraphBuffer.length = 0;
    }
  }

  function closeList() {
    if (inList) {
      output.push("</ul>");
      inList = false;
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("```")) {
      flushParagraph();
      closeList();
      output.push(inCodeBlock ? "</code></pre>" : "<pre><code>");
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      output.push(`${escapeHtml(line)}\n`);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }

    if (/^\s*---\s*$/.test(line)) {
      flushParagraph();
      closeList();
      output.push("<hr>");
      continue;
    }

    const headerCells = parseTableRow(line);
    if (
      headerCells &&
      index + 1 < lines.length &&
      isTableSeparatorRow(lines[index + 1], headerCells.length)
    ) {
      flushParagraph();
      closeList();

      const bodyRows = [];
      index += 2;
      while (index < lines.length) {
        const rowCells = parseTableRow(lines[index]);
        if (!rowCells || rowCells.length !== headerCells.length) {
          index -= 1;
          break;
        }
        bodyRows.push(rowCells);
        index += 1;
      }

      const headHtml = `<thead><tr>${headerCells
        .map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`)
        .join("")}</tr></thead>`;
      const bodyHtml = bodyRows.length
        ? `<tbody>${bodyRows
            .map(
              (row) =>
                `<tr>${row.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join("")}</tr>`
            )
            .join("")}</tbody>`
        : "";

      output.push(`<table>${headHtml}${bodyHtml}</table>`);
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      closeList();
      const level = headingMatch[1].length;
      output.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      closeList();
      output.push(`<blockquote>${renderInlineMarkdown(quoteMatch[1])}</blockquote>`);
      continue;
    }

    const checkboxMatch = line.match(/^[-*]\s+\[( |x|X)\]\s+(.*)$/);
    if (checkboxMatch) {
      flushParagraph();
      if (!inList) {
        output.push("<ul>");
        inList = true;
      }
      const checked = checkboxMatch[1].toLowerCase() === "x" ? " checked" : "";
      output.push(
        `<li class="task-item${checked ? " task-item-checked" : ""}"><input type="checkbox" class="task-checkbox" contenteditable="false"${checked}><span class="task-content${checked ? " task-content-checked" : ""}">${renderInlineMarkdown(checkboxMatch[2])}</span></li>`
      );
      continue;
    }

    const listMatch = line.match(/^[-*+]\s+(.*)$/);
    if (listMatch) {
      flushParagraph();
      if (!inList) {
        output.push("<ul>");
        inList = true;
      }
      output.push(`<li>${renderInlineMarkdown(listMatch[1])}</li>`);
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

function keepCaretVisible(rootElement, options = {}) {
  const { bottomBlockedHeight = 180 } = options;
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
  const topSafeZone = 12;
  const bottomSafeZone = Math.max(180, bottomBlockedHeight);
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

function selectionInsideRoot(rootElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !rootElement) {
    return false;
  }

  return rootElement.contains(selection.getRangeAt(0).startContainer);
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
      ["P", "DIV", "LI", "H1", "H2", "H3", "BLOCKQUOTE", "PRE"].includes(node.tagName)
    ) {
      return node;
    }
    node = node.parentNode;
  }

  return null;
}

function currentTaskItem(rootElement) {
  const block = currentBlockElement(rootElement);
  if (!block) {
    return null;
  }

  return block.classList?.contains("task-item") ? block : block.closest?.(".task-item") || null;
}

function currentTableRow(rootElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !rootElement) {
    return null;
  }

  let node = selection.anchorNode;
  while (node && node !== rootElement) {
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "TR") {
      return node;
    }
    node = node.parentNode;
  }

  return null;
}

function currentTableElement(rootElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !rootElement) {
    return null;
  }

  let node = selection.anchorNode;
  while (node && node !== rootElement) {
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "TABLE") {
      return node;
    }
    node = node.parentNode;
  }

  return null;
}

function ensureTrailingEditableParagraph(rootElement) {
  if (!rootElement) {
    return;
  }

  const lastElement = rootElement.lastElementChild;
  if (!lastElement) {
    rootElement.innerHTML = "<p><br></p>";
    return;
  }

  if (
    ["TABLE", "UL", "OL", "PRE", "BLOCKQUOTE", "H1", "H2", "H3"].includes(lastElement.tagName)
  ) {
    const paragraph = document.createElement("p");
    paragraph.appendChild(document.createElement("br"));
    rootElement.appendChild(paragraph);
  }
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

function blockHasRenderedInlineMarkdown(block) {
  if (!block || block.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }

  return Boolean(block.querySelector("strong, b, em, i, code, a"));
}

function createInlineTriggerMarker() {
  const marker = document.createElement("span");
  marker.setAttribute("data-inline-trigger", "true");
  marker.setAttribute("aria-hidden", "true");
  marker.textContent = "\u200b";
  return marker;
}

function selectionAtEndOfBlock(block) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !block) {
    return false;
  }

  const range = selection.getRangeAt(0);
  if (!range.collapsed || !block.contains(range.startContainer)) {
    return false;
  }

  const endRange = document.createRange();
  endRange.selectNodeContents(block);
  endRange.collapse(false);
  return range.compareBoundaryPoints(Range.START_TO_START, endRange) === 0;
}

function revertInlineMarkdownTriggerSpace(rootElement) {
  const block = currentBlockElement(rootElement);
  if (!block || block.tagName === "PRE") {
    return false;
  }

  if (!selectionAtEndOfBlock(block) || !blockHasRenderedInlineMarkdown(block)) {
    return false;
  }

  const rawInlineMarkdown = block.getAttribute("data-inline-markdown-raw");
  if (!rawInlineMarkdown) {
    return false;
  }

  block.textContent = rawInlineMarkdown;
  block.removeAttribute("data-inline-markdown-raw");
  placeCaretAtEnd(block);
  return true;
}

function applyMarkdownShortcut(rootElement, options = {}) {
  const { allowInline = true } = options;
  const block = currentBlockElement(rootElement);
  if (!block) {
    return false;
  }

  const text = block.textContent || "";

  if (allowInline && markdownPatternPresent(text) && block.tagName !== "PRE") {
    const inlineSource = text.endsWith(" ") ? text.slice(0, -1) : text;
    block.innerHTML = renderInlineMarkdown(inlineSource);
    if (text.endsWith(" ")) {
      block.setAttribute("data-inline-markdown-raw", inlineSource);
      block.appendChild(createInlineTriggerMarker());
    } else {
      block.removeAttribute("data-inline-markdown-raw");
    }
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
      paragraph.appendChild(document.createElement("br"));
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
  const floatingButtonSize = 52;
  const floatingButtonMargin = 16;
  const floatingBottomOffset = 88;

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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [floatingToolsOpen, setFloatingToolsOpen] = useState(false);
  const [tableToolsOpen, setTableToolsOpen] = useState(false);
  const [floatingToolsCorner, setFloatingToolsCorner] = useState("bottom-right");
  const [floatingToolsDragPosition, setFloatingToolsDragPosition] = useState(null);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [cursorAlignedY, setCursorAlignedY] = useState(null);
  const [saveRevision, setSaveRevision] = useState(0);
  const pendingSaveRef = useRef(false);
  const dirtyRef = useRef(false);
  const eventSourceRef = useRef(null);
  const visualEditorRef = useRef(null);
  const markdownEditorRef = useRef(null);
  const savedSelectionRef = useRef(null);
  const lastSyncedContentRef = useRef("");
  const lastKeyboardInsetRef = useRef(0);
  const floatingDragRef = useRef({
    active: false,
    moved: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    startLeft: 0,
    startTop: 0
  });

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
    ensureTrailingEditableParagraph(editor);
    normalizeLinkTargets(editor);
    normalizeInlineCaretBoundaries(editor);
  }

  function saveEditorSelection() {
    const editor = visualEditorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer)) {
      return;
    }

    savedSelectionRef.current = range.cloneRange();
  }

  function restoreEditorSelection() {
    const selection = window.getSelection();
    if (!selection || !savedSelectionRef.current) {
      return false;
    }

    try {
      selection.removeAllRanges();
      selection.addRange(savedSelectionRef.current.cloneRange());
      return true;
    } catch {
      return false;
    }
  }

  function ensureEditorSelection() {
    const editor = visualEditorRef.current;
    if (!editor) {
      return false;
    }

    if (selectionInsideRoot(editor)) {
      return true;
    }

    return restoreEditorSelection();
  }

  function currentEditorRange() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const editor = visualEditorRef.current;
    if (!editor || !editor.contains(range.startContainer)) {
      return null;
    }

    return range;
  }

  function closestInlineFormatAncestor(node) {
    const editor = visualEditorRef.current;
    let current = node?.nodeType === Node.TEXT_NODE ? node.parentNode : node;
    while (current && current !== editor) {
      if (
        current.nodeType === Node.ELEMENT_NODE &&
        (
          ["STRONG", "B", "EM", "I", "MARK", "DEL", "S", "STRIKE", "CODE", "A"].includes(current.tagName) ||
          current.classList?.contains("obsidian-tag")
        ) &&
        !(current.tagName === "CODE" && current.closest("pre"))
      ) {
        return current;
      }
      current = current.parentNode;
    }
    return null;
  }

  function wrapSelectionWithInlineTag(tagName) {
    if (editorMode !== "visual") {
      return false;
    }
    if (!ensureEditorSelection()) {
      setFloatingToolsOpen(false);
      return false;
    }

    const range = currentEditorRange();
    if (!range || range.collapsed) {
      setFloatingToolsOpen(false);
      return false;
    }

    const wrapper = document.createElement(tagName);
    const contents = range.extractContents();
    wrapper.appendChild(contents);
    range.insertNode(wrapper);

    const spacer = document.createTextNode("\u200b");
    wrapper.parentNode.insertBefore(spacer, wrapper.nextSibling);

    const selection = window.getSelection();
    if (selection) {
      const nextRange = document.createRange();
      nextRange.setStart(spacer, spacer.textContent.length);
      nextRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(nextRange);
      saveEditorSelection();
    }

    handleVisualInput();
    setFloatingToolsOpen(false);
    return true;
  }

  function unwrapSelectionFormatting() {
    if (editorMode !== "visual") {
      return false;
    }
    if (!ensureEditorSelection()) {
      setFloatingToolsOpen(false);
      return false;
    }

    const range = currentEditorRange();
    if (!range || range.collapsed) {
      setFloatingToolsOpen(false);
      return false;
    }

    document.execCommand("removeFormat", false);
    document.execCommand("unlink", false);

    const refreshedRange = currentEditorRange();
    if (refreshedRange && !refreshedRange.collapsed) {
      handleVisualInput();
      setFloatingToolsOpen(false);
      return true;
    }

    const plainText = range.toString();
    const startAncestor = closestInlineFormatAncestor(range.startContainer);
    const endAncestor = closestInlineFormatAncestor(range.endContainer);

    let textNode;
    if (
      startAncestor &&
      startAncestor === endAncestor &&
      plainText === (startAncestor.textContent || "")
    ) {
      textNode = document.createTextNode(plainText);
      startAncestor.parentNode.replaceChild(textNode, startAncestor);
    } else {
      range.deleteContents();
      textNode = document.createTextNode(plainText);
      range.insertNode(textNode);
    }

    const selection = window.getSelection();
    if (selection) {
      const nextRange = document.createRange();
      nextRange.setStart(textNode, plainText.length);
      nextRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(nextRange);
      saveEditorSelection();
    }

    handleVisualInput();
    setFloatingToolsOpen(false);
    return true;
  }

  function selectNodeContents(node) {
    const selection = window.getSelection();
    if (!selection || !node) {
      return;
    }

    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    saveEditorSelection();
  }

  function updateCursorAlignedY() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }
    const range = selection.getRangeAt(0);
    let rect = range.getBoundingClientRect();
    if (!rect || rect.height === 0) {
      let node = range.startContainer;
      if (node.nodeType === Node.TEXT_NODE) {
        node = node.parentNode;
      }
      if (node && typeof node.getBoundingClientRect === "function") {
        rect = node.getBoundingClientRect();
      }
    }
    if (!rect) {
      return;
    }
    // getBoundingClientRect is in visual viewport coords.
    // position:fixed uses layout viewport (ICB) coords.
    // vvp.offsetTop is the gap between them — must add it to convert.
    const vvp = window.visualViewport;
    const offsetTop = vvp?.offsetTop || 0;
    const effectiveHeight = vvp?.height || window.innerHeight;
    const cursorCenter = rect.top + offsetTop + rect.height / 2;
    const buttonTop = cursorCenter - floatingButtonSize / 2;
    setCursorAlignedY(
      Math.max(
        offsetTop + floatingButtonMargin,
        Math.min(buttonTop, offsetTop + effectiveHeight - floatingButtonSize - 4)
      )
    );
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
      lastSyncedContentRef.current = contentToSave;
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
        lastSyncedContentRef.current = notePayload.content;
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
    if (!loaded || editorMode !== "visual") {
      return;
    }

    function handleSelectionChange() {
      if (selectionInsideRoot(visualEditorRef.current)) {
        saveEditorSelection();
      }
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [editorMode, keyboardInset, loaded]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) {
      return;
    }

    function updateKeyboardInset() {
      const viewport = window.visualViewport;
      const viewportHeight = viewport?.height || window.innerHeight;
      const keyboardHeight = Math.max(0, window.innerHeight - viewportHeight - (viewport?.offsetTop || 0));
      const nextInset = keyboardHeight > 120 ? keyboardHeight : 0;
      if (Math.abs(nextInset - lastKeyboardInsetRef.current) < 24) {
        return;
      }
      lastKeyboardInsetRef.current = nextInset;
      setKeyboardInset(nextInset);
    }

    let scrollDebounce;
    function handleWindowScroll() {
      if (lastKeyboardInsetRef.current <= 0) {
        return;
      }
      clearTimeout(scrollDebounce);
      scrollDebounce = setTimeout(updateCursorAlignedY, 60);
    }

    updateKeyboardInset();
    window.visualViewport.addEventListener("resize", updateKeyboardInset);
    window.addEventListener("scroll", handleWindowScroll, { passive: true });

    return () => {
      window.visualViewport?.removeEventListener("resize", updateKeyboardInset);
      window.removeEventListener("scroll", handleWindowScroll);
      clearTimeout(scrollDebounce);
    };
  }, []);

  useEffect(() => {
    if (!loaded || editorMode !== "visual") {
      return;
    }

    if (keyboardInset > 0) {
      setTimeout(updateCursorAlignedY, 120);
    } else {
      setCursorAlignedY(null);
    }
  }, [editorMode, keyboardInset, loaded]);

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
          lastSyncedContentRef.current = nextNote.content;
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
    if (!loaded || !notePath) {
      return;
    }

    const intervalId = window.setInterval(async () => {
      if (dirtyRef.current || pendingSaveRef.current) {
        return;
      }

      try {
        const nextNote = await api(`/api/note?path=${encodeURIComponent(notePath)}`);
        if (nextNote.content === lastSyncedContentRef.current) {
          return;
        }

        const parsed = parseFrontmatter(nextNote.content);
        setMarkdownContent(parsed.body);
        setRawMarkdownContent(nextNote.content);
        lastSyncedContentRef.current = nextNote.content;
        setProperties(nextNote.properties || parsed.properties);
        setVisualHtml(nextNote.bodyHtml || nextNote.html);
        if (editorMode === "visual") {
          syncVisualEditor(nextNote.bodyHtml || nextNote.html);
        }
        setStatus("Live sync connected");
      } catch {
        setStatus("Live sync reconnecting...");
      }
    }, 1800);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [editorMode, loaded, notePath]);

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
      setVisualHtml(visualEditorRef.current.innerHTML);
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
      setVisualHtml(renderMarkdownBodyToHtml(parsed.body));
    }

    if (nextMode === "markdown") {
      setRawMarkdownContent(composeNoteMarkdown(properties, markdownContent));
    }

    setEditorMode(nextMode);
  }

  function rerenderNotePreview() {
    const nextBodyMarkdown =
      editorMode === "visual" && visualEditorRef.current
        ? htmlToMarkdown(visualEditorRef.current)
        : markdownContent;
    const nextHtml = renderMarkdownBodyToHtml(nextBodyMarkdown);
    setMarkdownContent(nextBodyMarkdown);
    setRawMarkdownContent(composeNoteMarkdown(properties, nextBodyMarkdown));
    setVisualHtml(nextHtml);
    if (editorMode === "visual") {
      syncVisualEditor(nextHtml);
    }
    setStatus("Preview refreshed");
  }

  function handleVisualInput() {
    if (!visualEditorRef.current) {
      return;
    }
    applyMarkdownShortcut(visualEditorRef.current, { allowInline: false });
    dirtyRef.current = true;
    setStatus("Editing...");
    const nextBody = htmlToMarkdown(visualEditorRef.current);
    setMarkdownContent(nextBody);
    setRawMarkdownContent(composeNoteMarkdown(properties, nextBody));
    setSaveRevision((value) => value + 1);
    saveEditorSelection();
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
    if (!visualEditorRef.current) {
      return;
    }

    if (event.key === "Enter") {
      const currentBlock = currentBlockElement(visualEditorRef.current);
      if (currentBlock?.tagName === "PRE" && currentBlock.parentNode) {
        event.preventDefault();
        const paragraph = document.createElement("p");
        paragraph.appendChild(document.createElement("br"));
        currentBlock.insertAdjacentElement("afterend", paragraph);
        placeCaretAtStart(paragraph);
        handleVisualInput();
        return;
      }

      if (
        currentBlock &&
        ["H1", "H2", "H3"].includes(currentBlock.tagName) &&
        currentBlock.parentNode
      ) {
        event.preventDefault();
        const paragraph = document.createElement("p");
        paragraph.appendChild(document.createElement("br"));
        currentBlock.insertAdjacentElement("afterend", paragraph);
        placeCaretAtStart(paragraph);
        handleVisualInput();
        return;
      }

      if (currentBlock?.tagName === "BLOCKQUOTE" && currentBlock.parentNode) {
        event.preventDefault();
        const paragraph = document.createElement("p");
        paragraph.appendChild(document.createElement("br"));
        currentBlock.insertAdjacentElement("afterend", paragraph);
        placeCaretAtStart(paragraph);
        handleVisualInput();
        return;
      }

      if (
        currentBlock?.tagName === "LI" &&
        !currentBlock.querySelector('input[type="checkbox"]') &&
        currentBlock.parentNode
      ) {
        event.preventDefault();
        const nextItem = document.createElement("li");
        nextItem.appendChild(document.createElement("br"));
        currentBlock.insertAdjacentElement("afterend", nextItem);
        placeCaretAtStart(nextItem);
        handleVisualInput();
        return;
      }

      const taskItem = currentTaskItem(visualEditorRef.current);
      if (taskItem) {
        event.preventDefault();
        const nextTaskItem = createTaskListItem(false, "<br>");
        taskItem.insertAdjacentElement("afterend", nextTaskItem);
        placeCaretInsideTaskContent(nextTaskItem);
        handleVisualInput();
        return;
      }
    }

    if (event.key === "Backspace" && revertStructuredBlockToMarkdown(visualEditorRef.current)) {
      event.preventDefault();
      handleVisualInput();
    }
  }

  function handleVisualBeforeInput(event) {
    if (!visualEditorRef.current) {
      return;
    }

    if (event.inputType === "insertText" && event.data) {
      if (routeTypingOutsideInlineWrapper(visualEditorRef.current, event.data)) {
        event.preventDefault();
        handleVisualInput();
      }
      return;
    }

    if (event.inputType !== "deleteContentBackward") {
      return;
    }

    if (revertInlineMarkdownTriggerSpace(visualEditorRef.current)) {
      event.preventDefault();
      handleVisualInput();
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

  function runMarkdownHistoryCommand(command) {
    const textarea = markdownEditorRef.current;
    if (!textarea) {
      return;
    }

    textarea.focus();
    document.execCommand(command, false);
  }

  function applyCommand(command, value) {
    if (editorMode !== "visual") {
      return;
    }
    if (!ensureEditorSelection()) {
      setFloatingToolsOpen(false);
      return;
    }
    const range = currentEditorRange();
    if (!range || range.collapsed) {
      setFloatingToolsOpen(false);
      return;
    }
    if (command === "bold") {
      wrapSelectionWithInlineTag("strong");
      return;
    }
    if (command === "highlight") {
      wrapSelectionWithInlineTag("mark");
      return;
    }
    if (command === "strikeThrough") {
      wrapSelectionWithInlineTag("del");
      return;
    }
    if (command === "italic") {
      wrapSelectionWithInlineTag("em");
      return;
    }
    document.execCommand(command, false, value);
    handleVisualInput();
    setFloatingToolsOpen(false);
  }

  function applyHeadingCommand(level) {
    if (editorMode !== "visual") {
      return;
    }
    if (!ensureEditorSelection()) {
      setFloatingToolsOpen(false);
      return;
    }

    const range = currentEditorRange();
    if (!range) {
      setFloatingToolsOpen(false);
      return;
    }

    if (range.collapsed) {
      const editor = visualEditorRef.current;
      const currentBlock = currentBlockElement(editor);
      const heading = document.createElement(`h${level}`);
      heading.appendChild(document.createElement("br"));

      if (currentBlock?.parentNode) {
        if (!isEffectivelyEmptyBlock(currentBlock)) {
          setFloatingToolsOpen(false);
          return;
        }
        currentBlock.parentNode.replaceChild(heading, currentBlock);
      } else if (editor) {
        editor.innerHTML = "";
        editor.appendChild(heading);
      } else {
        setFloatingToolsOpen(false);
        return;
      }

      placeCaretAtStart(heading);
      handleVisualInput();
      setFloatingToolsOpen(false);
      return;
    }

    document.execCommand("formatBlock", false, `<h${level}>`);
    handleVisualInput();
    setFloatingToolsOpen(false);
  }

  function handleToolbarPointerDown(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function floatingCornerPosition(corner) {
    const viewportWidth = typeof window !== "undefined" ? window.innerWidth || 390 : 390;
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight || 844 : 844;
    const vvp = typeof window !== "undefined" ? window.visualViewport : null;
    const offsetTop = keyboardInset > 0 ? (vvp?.offsetTop || 0) : 0;
    const effectiveHeight = keyboardInset > 0 ? (vvp?.height || viewportHeight) : viewportHeight;
    const top = corner.startsWith("top")
      ? offsetTop + floatingButtonMargin
      : offsetTop + effectiveHeight - floatingBottomOffset - floatingButtonSize;
    const left = corner.endsWith("left")
      ? floatingButtonMargin
      : viewportWidth - floatingButtonMargin - floatingButtonSize;

    return { left, top };
  }

  function floatingButtonPosition() {
    if (keyboardInset > 0 && cursorAlignedY !== null) {
      const viewportWidth = typeof window !== "undefined" ? window.innerWidth || 390 : 390;
      const isLeft = floatingToolsCorner.endsWith("left");
      return {
        left: isLeft ? floatingButtonMargin : viewportWidth - floatingButtonMargin - floatingButtonSize,
        top: cursorAlignedY
      };
    }
    return floatingToolsDragPosition || floatingCornerPosition(floatingToolsCorner);
  }

  function clampFloatingDragPosition(left, top) {
    const viewportWidth = typeof window !== "undefined" ? window.innerWidth || 390 : 390;
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight || 844 : 844;
    const vvp = typeof window !== "undefined" ? window.visualViewport : null;
    const offsetTop = keyboardInset > 0 ? (vvp?.offsetTop || 0) : 0;
    const effectiveHeight = keyboardInset > 0 ? (vvp?.height || viewportHeight) : viewportHeight;
    return {
      left: Math.min(
        Math.max(left, floatingButtonMargin),
        viewportWidth - floatingButtonMargin - floatingButtonSize
      ),
      top: Math.min(
        Math.max(top, offsetTop + floatingButtonMargin),
        offsetTop + effectiveHeight - floatingButtonMargin - floatingButtonSize
      )
    };
  }

  function dragDirectionCorner(deltaX, deltaY) {
    const currentVertical = floatingToolsCorner.startsWith("top") ? "top" : "bottom";
    const currentHorizontal = floatingToolsCorner.endsWith("left") ? "left" : "right";
    const horizontal = Math.abs(deltaX) < 8 ? currentHorizontal : deltaX < 0 ? "left" : "right";
    const vertical = Math.abs(deltaY) < 8 ? currentVertical : deltaY < 0 ? "top" : "bottom";
    return `${vertical}-${horizontal}`;
  }

  function handleFloatingButtonPointerDown(event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const current = floatingButtonPosition();
    const drag = floatingDragRef.current;
    drag.active = true;
    drag.moved = false;
    drag.pointerId = event.pointerId;
    drag.startX = event.clientX;
    drag.startY = event.clientY;
    drag.startLeft = current.left;
    drag.startTop = current.top;
  }

  function handleFloatingButtonPointerMove(event) {
    event.stopPropagation();
    const drag = floatingDragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
      drag.moved = true;
    }

    setFloatingToolsDragPosition(
      clampFloatingDragPosition(drag.startLeft + deltaX, drag.startTop + deltaY)
    );
  }

  function handleFloatingButtonPointerUp(event) {
    event.stopPropagation();
    const drag = floatingDragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) {
      return;
    }

    event.currentTarget.releasePointerCapture?.(event.pointerId);
    drag.active = false;
    drag.pointerId = null;

    if (!drag.moved) {
      setFloatingToolsOpen((value) => {
        const nextValue = !value;
        if (!nextValue) {
          setTableToolsOpen(false);
        }
        return nextValue;
      });
      setFloatingToolsDragPosition(null);
      return;
    }

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    setFloatingToolsCorner(dragDirectionCorner(deltaX, deltaY));
    setFloatingToolsDragPosition(null);
  }

  function runHistoryCommand(command) {
    if (editorMode !== "visual") {
      return;
    }

    if (!ensureEditorSelection()) {
      setFloatingToolsOpen(false);
      return;
    }
    document.execCommand(command, false);
    handleVisualInput();
    setTableToolsOpen(false);
    setFloatingToolsOpen(false);
  }

  function insertInlineCode() {
    if (editorMode !== "visual" || !visualEditorRef.current) {
      return;
    }
    if (!ensureEditorSelection()) {
      setFloatingToolsOpen(false);
      return;
    }
    const range = currentEditorRange();
    if (!range || range.collapsed) {
      setFloatingToolsOpen(false);
      return;
    }
    wrapSelectionWithInlineTag("code");
  }

  function insertBullet() {
    if (editorMode !== "visual" || !visualEditorRef.current) {
      return;
    }
    if (!ensureEditorSelection()) {
      setFloatingToolsOpen(false);
      return;
    }

    const editor = visualEditorRef.current;
    const range = currentEditorRange();
    const currentBlock = currentBlockElement(editor);
    const list = document.createElement("ul");
    const item = document.createElement("li");
    item.appendChild(document.createElement("br"));
    list.appendChild(item);

    if (currentBlock?.parentNode) {
      currentBlock.parentNode.replaceChild(list, currentBlock);
    } else {
      editor.innerHTML = "";
      editor.appendChild(list);
    }

    placeCaretAtStart(item);
    handleVisualInput({ skipRevert: true });
    setFloatingToolsOpen(false);
  }

  function insertOrderedList() {
    if (editorMode !== "visual" || !visualEditorRef.current) {
      return;
    }
    if (!ensureEditorSelection()) {
      setFloatingToolsOpen(false);
      return;
    }

    const editor = visualEditorRef.current;
    const currentBlock = currentBlockElement(editor);
    const list = document.createElement("ol");
    const item = document.createElement("li");
    item.appendChild(document.createElement("br"));
    list.appendChild(item);

    if (currentBlock?.parentNode) {
      currentBlock.parentNode.replaceChild(list, currentBlock);
    } else {
      editor.innerHTML = "";
      editor.appendChild(list);
    }

    placeCaretAtStart(item);
    handleVisualInput({ skipRevert: true });
    setFloatingToolsOpen(false);
  }

  function insertHorizontalRuleAtEmptyLine() {
    if (editorMode !== "visual" || !visualEditorRef.current) {
      return;
    }
    if (!ensureEditorSelection()) {
      setFloatingToolsOpen(false);
      return;
    }

    const editor = visualEditorRef.current;
    const currentBlock = currentBlockElement(editor);
    if (!currentBlock || !isEffectivelyEmptyBlock(currentBlock)) {
      setFloatingToolsOpen(false);
      return;
    }

    const fragment = document.createDocumentFragment();
    const rule = document.createElement("hr");
    const paragraph = document.createElement("p");
    paragraph.appendChild(document.createElement("br"));
    fragment.appendChild(rule);
    fragment.appendChild(paragraph);

    currentBlock.parentNode?.replaceChild(fragment, currentBlock);
    placeCaretAtStart(paragraph);
    handleVisualInput();
    setFloatingToolsOpen(false);
  }

  function appendTableRowBelow() {
    if (editorMode !== "visual" || !visualEditorRef.current) {
      return;
    }
    if (!ensureEditorSelection()) {
      setFloatingToolsOpen(false);
      return;
    }

    const editor = visualEditorRef.current;
    const currentRow = currentTableRow(editor);
    if (!currentRow) {
      setFloatingToolsOpen(false);
      return;
    }

    const cellCount = Array.from(currentRow.children).filter((cell) =>
      ["TH", "TD"].includes(cell.tagName)
    ).length;
    if (cellCount === 0) {
      setFloatingToolsOpen(false);
      return;
    }

    const parentSection = currentRow.parentNode;
    const table = currentRow.closest("table");
    const nextRow = document.createElement("tr");
    for (let index = 0; index < cellCount; index += 1) {
      const cell = document.createElement("td");
      cell.appendChild(document.createElement("br"));
      nextRow.appendChild(cell);
    }

    if (parentSection?.tagName === "THEAD" && table) {
      let tbody = table.querySelector("tbody");
      if (!tbody) {
        tbody = document.createElement("tbody");
        table.appendChild(tbody);
      }
      tbody.insertBefore(nextRow, tbody.firstChild);
    } else {
      currentRow.insertAdjacentElement("afterend", nextRow);
    }

    placeCaretAtStart(nextRow.children[0]);
    handleVisualInput();
    setFloatingToolsOpen(false);
  }

  function createTableAtEmptyLine() {
    if (editorMode !== "visual" || !visualEditorRef.current) {
      return;
    }
    if (!ensureEditorSelection()) {
      setFloatingToolsOpen(false);
      return;
    }

    const editor = visualEditorRef.current;
    const currentBlock = currentBlockElement(editor);
    if (!currentBlock || !isEffectivelyEmptyBlock(currentBlock)) {
      setFloatingToolsOpen(false);
      return;
    }

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    const headCellOne = document.createElement("th");
    const headCellTwo = document.createElement("th");
    headCellOne.appendChild(document.createElement("br"));
    headCellTwo.appendChild(document.createElement("br"));
    headRow.appendChild(headCellOne);
    headRow.appendChild(headCellTwo);
    thead.appendChild(headRow);

    const tbody = document.createElement("tbody");
    const bodyRow = document.createElement("tr");
    const bodyCellOne = document.createElement("td");
    const bodyCellTwo = document.createElement("td");
    bodyCellOne.appendChild(document.createElement("br"));
    bodyCellTwo.appendChild(document.createElement("br"));
    bodyRow.appendChild(bodyCellOne);
    bodyRow.appendChild(bodyCellTwo);
    tbody.appendChild(bodyRow);

    table.appendChild(thead);
    table.appendChild(tbody);
    currentBlock.parentNode?.replaceChild(table, currentBlock);

    placeCaretAtStart(headCellOne);
    handleVisualInput();
    setTableToolsOpen(false);
    setFloatingToolsOpen(false);
  }

  function appendTableColumnRight() {
    if (editorMode !== "visual" || !visualEditorRef.current) {
      return;
    }
    if (!ensureEditorSelection()) {
      setFloatingToolsOpen(false);
      return;
    }

    const editor = visualEditorRef.current;
    const table = currentTableElement(editor);
    if (!table) {
      setFloatingToolsOpen(false);
      return;
    }

    const currentRow = currentTableRow(editor);
    let targetColumnIndex = -1;
    if (currentRow) {
      const selection = window.getSelection();
      const anchorNode = selection?.anchorNode || null;
      const currentCell = anchorNode?.nodeType === Node.ELEMENT_NODE
        ? anchorNode.closest?.("td, th")
        : anchorNode?.parentNode?.closest?.("td, th");
      if (currentCell) {
        targetColumnIndex = Array.from(currentRow.children).indexOf(currentCell);
      }
    }

    const rows = Array.from(table.querySelectorAll("tr"));
    if (rows.length === 0) {
      setFloatingToolsOpen(false);
      return;
    }

    rows.forEach((row) => {
      const cells = Array.from(row.children).filter((cell) => ["TH", "TD"].includes(cell.tagName));
      const insertAfterIndex = targetColumnIndex >= 0 ? targetColumnIndex : cells.length - 1;
      const referenceCell = cells[insertAfterIndex] || null;
      const newCell = document.createElement(row.parentNode?.tagName === "THEAD" ? "th" : "td");
      newCell.appendChild(document.createElement("br"));
      if (referenceCell) {
        referenceCell.insertAdjacentElement("afterend", newCell);
      } else {
        row.appendChild(newCell);
      }
    });

    const focusRow = currentTableRow(editor) || rows[0];
    const focusCells = Array.from(focusRow.children).filter((cell) => ["TH", "TD"].includes(cell.tagName));
    const nextFocusCell = focusCells[Math.max(0, targetColumnIndex + 1)] || focusCells[focusCells.length - 1];
    if (nextFocusCell) {
      placeCaretAtStart(nextFocusCell);
    }
    handleVisualInput();
    setTableToolsOpen(false);
    setFloatingToolsOpen(false);
  }

  function deleteCurrentTableRow() {
    if (editorMode !== "visual" || !visualEditorRef.current) {
      return;
    }
    if (!ensureEditorSelection()) {
      setFloatingToolsOpen(false);
      return;
    }

    const editor = visualEditorRef.current;
    const currentRow = currentTableRow(editor);
    const table = currentTableElement(editor);
    if (!currentRow || !table) {
      setFloatingToolsOpen(false);
      return;
    }

    const allRows = Array.from(table.querySelectorAll("tr"));
    if (allRows.length <= 1) {
      const paragraph = document.createElement("p");
      paragraph.appendChild(document.createElement("br"));
      table.replaceWith(paragraph);
      placeCaretAtStart(paragraph);
      handleVisualInput();
      setTableToolsOpen(false);
      setFloatingToolsOpen(false);
      return;
    }

    const nextRow =
      currentRow.nextElementSibling?.tagName === "TR"
        ? currentRow.nextElementSibling
        : currentRow.previousElementSibling?.tagName === "TR"
          ? currentRow.previousElementSibling
          : null;

    const parentSection = currentRow.parentNode;
    currentRow.remove();

    if (parentSection?.tagName === "THEAD" && table.querySelectorAll("thead tr").length === 0) {
      parentSection.remove();
    }
    if (parentSection?.tagName === "TBODY" && parentSection.querySelectorAll("tr").length === 0) {
      parentSection.remove();
    }

    if (nextRow) {
      const nextCell = nextRow.querySelector("th, td");
      if (nextCell) {
        placeCaretAtStart(nextCell);
      }
    }

    handleVisualInput();
    setTableToolsOpen(false);
    setFloatingToolsOpen(false);
  }

  function deleteCurrentTableColumn() {
    if (editorMode !== "visual" || !visualEditorRef.current) {
      return;
    }
    if (!ensureEditorSelection()) {
      setFloatingToolsOpen(false);
      return;
    }

    const editor = visualEditorRef.current;
    const table = currentTableElement(editor);
    const currentRow = currentTableRow(editor);
    if (!table || !currentRow) {
      setFloatingToolsOpen(false);
      return;
    }

    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode || null;
    const currentCell =
      anchorNode?.nodeType === Node.ELEMENT_NODE
        ? anchorNode.closest?.("td, th")
        : anchorNode?.parentNode?.closest?.("td, th");
    const currentCells = Array.from(currentRow.children).filter((cell) => ["TH", "TD"].includes(cell.tagName));
    const targetColumnIndex = currentCell ? currentCells.indexOf(currentCell) : -1;
    if (targetColumnIndex < 0) {
      setFloatingToolsOpen(false);
      return;
    }

    if (currentCells.length <= 1) {
      const paragraph = document.createElement("p");
      paragraph.appendChild(document.createElement("br"));
      table.replaceWith(paragraph);
      placeCaretAtStart(paragraph);
      handleVisualInput();
      setTableToolsOpen(false);
      setFloatingToolsOpen(false);
      return;
    }

    Array.from(table.querySelectorAll("tr")).forEach((row) => {
      const cells = Array.from(row.children).filter((cell) => ["TH", "TD"].includes(cell.tagName));
      const cellToRemove = cells[targetColumnIndex];
      cellToRemove?.remove();
    });

    const focusRow = currentTableRow(editor) || table.querySelector("tr");
    const focusCells = focusRow
      ? Array.from(focusRow.children).filter((cell) => ["TH", "TD"].includes(cell.tagName))
      : [];
    const nextFocusCell = focusCells[Math.max(0, targetColumnIndex - 1)] || focusCells[0];
    if (nextFocusCell) {
      placeCaretAtStart(nextFocusCell);
    }

    handleVisualInput();
    setTableToolsOpen(false);
    setFloatingToolsOpen(false);
  }

  function insertCodeBlock() {
    if (editorMode !== "visual" || !visualEditorRef.current) {
      return;
    }
    if (!ensureEditorSelection()) {
      setFloatingToolsOpen(false);
      return;
    }

    const range = currentEditorRange();
    if (!range || range.collapsed) {
      setFloatingToolsOpen(false);
      return;
    }

    const selectedText = range.toString();
    const currentBlock = currentBlockElement(visualEditorRef.current);
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = selectedText;
    pre.appendChild(code);

    const paragraph = document.createElement("p");
    paragraph.appendChild(document.createElement("br"));

    if (currentBlock?.parentNode) {
      currentBlock.parentNode.replaceChild(pre, currentBlock);
      pre.insertAdjacentElement("afterend", paragraph);
    } else {
      range.deleteContents();
      range.insertNode(pre);
      pre.insertAdjacentElement("afterend", paragraph);
    }

    placeCaretAtStart(paragraph);
    handleVisualInput();
    setFloatingToolsOpen(false);
  }

  function insertCheckbox() {
    if (editorMode !== "visual" || !visualEditorRef.current) {
      return;
    }
    const editor = visualEditorRef.current;
    if (!ensureEditorSelection()) {
      setFloatingToolsOpen(false);
      return;
    }

    const range = currentEditorRange();
    if (!range && !editor) {
      setFloatingToolsOpen(false);
      return;
    }

    const selectedText = range.toString().trim();

    const taskItem = currentTaskItem(editor);
    if (taskItem) {
      const nextTaskItem = createTaskListItem(false, renderInlineMarkdown(selectedText || ""));
      taskItem.insertAdjacentElement("afterend", nextTaskItem);
      placeCaretInsideTaskContent(nextTaskItem);
      handleVisualInput();
      setFloatingToolsOpen(false);
      return;
    }

    const currentBlock = currentBlockElement(editor);
    const list = document.createElement("ul");
    const itemHtml = selectedText
      ? renderInlineMarkdown(selectedText)
      : currentBlock?.innerHTML || "<br>";
    const item = createTaskListItem(false, itemHtml);
    list.appendChild(item);

    if (currentBlock && currentBlock.parentNode) {
      currentBlock.parentNode.replaceChild(list, currentBlock);
    } else {
      editor.innerHTML = "";
      editor.appendChild(list);
    }

    normalizeLinkTargets(item);
    placeCaretInsideTaskContent(item);
    handleVisualInput();
    setFloatingToolsOpen(false);
  }

  function handleVisualPointerDown(event) {
    const checkbox = event.target.closest(".task-checkbox");
    if (!checkbox) {
      return;
    }

    event.preventDefault();
    checkbox.checked = !checkbox.checked;
    syncTaskItemState(checkbox.closest(".task-item"));
    handleVisualInput();
  }

  function onVisualClick(event) {
    const checkbox = event.target.closest(".task-checkbox");
    if (checkbox) {
      event.preventDefault();
      return;
    }

    const externalLink = event.target.closest('a[href]:not([data-note-link])');
    if (externalLink) {
      event.preventDefault();
      const href = externalLink.getAttribute("href");
      if (href) {
        window.open(href, "_blank", "noopener,noreferrer");
      }
      return;
    }

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

  const floatingPosition = floatingButtonPosition();
  const displayFloatingCorner = floatingToolsCorner;
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 390;
  const panelWidth = Math.min(Math.max(240, viewportWidth - 32), 448);
  const desiredFloatingPanelLeft = displayFloatingCorner.endsWith("left")
    ? floatingPosition.left
    : floatingPosition.left + floatingButtonSize - panelWidth;
  const floatingPanelLeft = Math.min(
    Math.max(16, desiredFloatingPanelLeft),
    Math.max(16, viewportWidth - panelWidth - 16)
  );
  const floatingPanelTop = (keyboardInset > 0 && cursorAlignedY !== null) || displayFloatingCorner.startsWith("bottom")
    ? Math.max(16, floatingPosition.top - 12 - 80)
    : floatingPosition.top + floatingButtonSize + 12;

  const toolRegistry = {
    bullet: {
      label: "List",
      title: "List",
      onClick: insertBullet,
      icon: <img src="/svg/bullet.svg" alt="" aria-hidden="true" width="18" height="18" />
    },
    ordered_list: {
      label: "Ordered list",
      title: "Ordered list",
      onClick: insertOrderedList,
      icon: <img src="/svg/ordered_list.svg" alt="" aria-hidden="true" width="18" height="18" />
    },
    checkbox: {
      label: "Checkbox",
      title: "Checkbox",
      onClick: insertCheckbox,
      icon: <img src="/svg/checkbox.svg" alt="" aria-hidden="true" width="18" height="18" />
    },
    divider: {
      label: "Divider",
      title: "Divider",
      onClick: insertHorizontalRuleAtEmptyLine,
      icon: <img src="/svg/divider.svg" alt="" aria-hidden="true" width="18" height="18" />
    },
    table: {
      label: "Table tools",
      title: "Table tools",
      onClick: () => setTableToolsOpen(true),
      icon: <img src="/svg/table.svg" alt="" aria-hidden="true" width="18" height="18" />
    },
    bold: {
      label: "Bold",
      title: "Bold",
      onClick: () => applyCommand("bold"),
      icon: <img src="/svg/bold.svg" alt="" aria-hidden="true" width="18" height="18" />
    },
    reformat: {
      label: "Reformatter",
      title: "Reformatter",
      onClick: unwrapSelectionFormatting,
      icon: <img src="/svg/reformat.svg" alt="" aria-hidden="true" width="18" height="18" />
    },
    highlight: {
      label: "Highlight",
      title: "Highlight",
      onClick: () => applyCommand("highlight"),
      icon: <img src="/svg/highlight.svg" alt="" aria-hidden="true" width="18" height="18" />
    },
    strikethrough: {
      label: "Strikethrough",
      title: "Strikethrough",
      onClick: () => applyCommand("strikeThrough"),
      icon: <img src="/svg/strikethrough.svg" alt="" aria-hidden="true" width="18" height="18" />
    },
    italic: {
      label: "Italic",
      title: "Italic",
      onClick: () => applyCommand("italic"),
      icon: <img src="/svg/italic.svg" alt="" aria-hidden="true" width="18" height="18" />
    },
    code: {
      label: "Code",
      title: "Code",
      onClick: insertInlineCode,
      icon: <img src="/svg/code.svg" alt="" aria-hidden="true" width="18" height="18" />
    },
    heading1: {
      label: "Heading 1",
      title: "Heading 1",
      onClick: () => applyHeadingCommand(1),
      icon: <img src="/svg/heading1.svg" alt="" aria-hidden="true" width="18" height="18" />
    },
    heading2: {
      label: "Heading 2",
      title: "Heading 2",
      onClick: () => applyHeadingCommand(2),
      icon: <img src="/svg/heading2.svg" alt="" aria-hidden="true" width="18" height="18" />
    },
    heading3: {
      label: "Heading 3",
      title: "Heading 3",
      onClick: () => applyHeadingCommand(3),
      icon: <img src="/svg/heading3.svg" alt="" aria-hidden="true" width="18" height="18" />
    },
    table_add: {
      label: "Create table",
      title: "Create table",
      onClick: createTableAtEmptyLine,
      icon: <img src="/svg/table_add.svg" alt="" aria-hidden="true" width="18" height="18" />
    },
    row_add: {
      label: "Append row below",
      title: "Append row below",
      onClick: appendTableRowBelow,
      icon: <img src="/svg/row_add.svg" alt="" aria-hidden="true" width="18" height="18" />
    },
    column_add: {
      label: "Append column right",
      title: "Append column right",
      onClick: appendTableColumnRight,
      icon: <img src="/svg/column_add.svg" alt="" aria-hidden="true" width="18" height="18" />
    },
    row_delete: {
      label: "Delete current row",
      title: "Delete current row",
      onClick: deleteCurrentTableRow,
      icon: <img src="/svg/row_delete.svg" alt="" aria-hidden="true" width="18" height="18" />
    },
    column_delete: {
      label: "Delete current column",
      title: "Delete current column",
      onClick: deleteCurrentTableColumn,
      icon: <img src="/svg/column_delete.svg" alt="" aria-hidden="true" width="18" height="18" />
    },
    block: {
      label: "Block",
      title: "Block",
      onClick: insertCodeBlock,
      icon: "🧱"
    }
  };

  const mainToolIds = resolveVisibleToolIds(toolConfig.mainTools, toolConfig.hiddenTools, toolRegistry);
  const tableToolIds = resolveVisibleToolIds(toolConfig.tableTools, toolConfig.hiddenTools, toolRegistry);

  function renderToolButton(toolId) {
    const tool = toolRegistry[toolId];
    if (!tool) {
      return null;
    }

    return (
      <button
        key={toolId}
        type="button"
        className="toolbar-button"
        aria-label={tool.label}
        title={tool.title}
        onPointerDown={handleToolbarPointerDown}
        onClick={tool.onClick}
      >
        {tool.icon}
      </button>
    );
  }

  function openNoteFromSidebar(nextPath) {
    setSidebarOpen(false);
    if (!nextPath || nextPath === notePath) {
      return;
    }
    router.push(`/note?path=${encodeURIComponent(nextPath)}`);
  }

  return (
    <>
      <Head>
        <title>{noteTitle()}</title>
      </Head>
<section className="note-mobile-screen">
        {sidebarOpen ? (
          <>
            <div className="note-sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
            <aside className="note-sidebar-drawer">
              <div className="note-sidebar-header">
                <h2>Notes</h2>
              </div>
              {tree ? (
                <div className="tree-view note-sidebar-tree">
                  <NoteSidebarTreeNode
                    node={tree}
                    currentPath={notePath}
                    onOpenNote={openNoteFromSidebar}
                  />
                </div>
              ) : null}
            </aside>
          </>
        ) : null}
        <header className="note-mobile-header">
          <div className="note-header-toprow">
            <div className="note-header-left">
              <Link href="/app" className="icon-button" aria-label="Back to notes" title="Back to notes">
                <img src="/svg/homepage.svg" alt="" aria-hidden="true" width="18" height="18" />
              </Link>
              <button
                type="button"
                className="icon-button note-sidebar-toggle"
                onClick={() => setSidebarOpen((value) => !value)}
                aria-label="Open note sidebar"
                title="Open note sidebar"
              >
                <img src="/svg/sidebar.svg" alt="" aria-hidden="true" width="18" height="18" />
              </button>
            </div>
            <div className="note-header-actions">
              {editorMode === "markdown" ? (
                <>
                  <button
                    type="button"
                    className="chip-button"
                    onClick={() => runMarkdownHistoryCommand("undo")}
                    aria-label="Undo"
                    title="Undo"
                  >
                    <img src="/svg/undo.svg" alt="" aria-hidden="true" width="18" height="18" />
                  </button>
                  <button
                    type="button"
                    className="chip-button"
                    onClick={() => runMarkdownHistoryCommand("redo")}
                    aria-label="Redo"
                    title="Redo"
                  >
                    <img src="/svg/redo.svg" alt="" aria-hidden="true" width="18" height="18" />
                  </button>
                </>
              ) : null}
              {editorMode === "visual" ? (
                <>
                  <button
                    type="button"
                    className="chip-button"
                    onClick={() => runHistoryCommand("undo")}
                    aria-label="Undo"
                    title="Undo"
                  >
                    <img src="/svg/undo.svg" alt="" aria-hidden="true" width="18" height="18" />
                  </button>
                  <button
                    type="button"
                    className="chip-button"
                    onClick={() => runHistoryCommand("redo")}
                    aria-label="Redo"
                    title="Redo"
                  >
                    <img src="/svg/redo.svg" alt="" aria-hidden="true" width="18" height="18" />
                  </button>
                </>
              ) : null}
              {editorMode === "visual" ? (
                <button
                  type="button"
                  className="chip-button"
                  onClick={rerenderNotePreview}
                  aria-label="Refresh preview"
                  title="Refresh preview"
                >
                  <img src="/svg/refresh.svg" alt="" aria-hidden="true" width="18" height="18" />
                </button>
              ) : null}
              <button
                type="button"
                className={editorMode === "markdown" ? "chip-button mode-toggle-button active" : "chip-button mode-toggle-button"}
                onClick={() => void switchMode(editorMode === "visual" ? "markdown" : "visual")}
                aria-label={editorMode === "visual" ? "Switch to markdown view" : "Switch to note view"}
                title={editorMode === "visual" ? "Switch to markdown view" : "Switch to note view"}
              >
                <img src="/svg/source_mode.svg" alt="" aria-hidden="true" width="18" height="18" />
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
            onPointerDown={handleVisualPointerDown}
            onPointerUp={() => { if (keyboardInset > 0) window.requestAnimationFrame(updateCursorAlignedY); }}
            onClick={onVisualClick}
          />
          ) : (
            <textarea
              ref={markdownEditorRef}
              className="markdown-editor-surface"
              value={rawMarkdownContent}
              onChange={handleMarkdownChange}
            />
          )}
        </main>

        {editorMode === "visual" ? (
          <>
            <button
              type="button"
              className="floating-tools-button"
              style={{
                ...floatingPosition,
                transition: floatingToolsDragPosition ? "none" : "left 180ms ease, top 180ms ease"
              }}
              onPointerDown={handleFloatingButtonPointerDown}
              onPointerMove={handleFloatingButtonPointerMove}
              onPointerUp={handleFloatingButtonPointerUp}
              onPointerCancel={handleFloatingButtonPointerUp}
              onClick={(event) => event.stopPropagation()}
              aria-label="Tools"
            >
              🛠
            </button>
            {floatingToolsOpen ? (
              <aside
                className="floating-tools-panel"
                style={{
                  left: floatingPanelLeft,
                  top: floatingPanelTop,
                  transition: floatingToolsDragPosition ? "none" : "left 180ms ease, top 180ms ease"
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                {tableToolsOpen ? (
                  tableToolIds.map(renderToolButton)
                ) : (
                  mainToolIds.map(renderToolButton)
                )}
              </aside>
            ) : null}
          </>
        ) : null}
      </section>
    </>
  );
}
