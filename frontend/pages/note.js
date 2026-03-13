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
      ["P", "DIV", "LI", "H1", "H2", "H3", "BLOCKQUOTE"].includes(node.tagName)
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

  if (block.tagName === "LI" && !block.querySelector('input[type="checkbox"]')) {
    const nestedCheckboxMatch = text.match(/^\[( |x|X)\]\s*(.*)$/);
    if (nestedCheckboxMatch) {
      const taskItem = createTaskListItem(
        nestedCheckboxMatch[1].toLowerCase() === "x",
        renderInlineMarkdown(nestedCheckboxMatch[2] || "")
      );
      parent.replaceChild(taskItem, block);
      normalizeLinkTargets(taskItem);
      placeCaretInsideTaskContent(taskItem);
      return true;
    }
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
    const item = createTaskListItem(
      checkboxMatch[1].toLowerCase() === "x",
      renderInlineMarkdown(checkboxMatch[2] || "")
    );
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
  const [floatingToolsOpen, setFloatingToolsOpen] = useState(false);
  const [floatingToolsCorner, setFloatingToolsCorner] = useState("bottom-right");
  const [floatingToolsDragPosition, setFloatingToolsDragPosition] = useState(null);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [cursorAlignedY, setCursorAlignedY] = useState(null);
  const [saveRevision, setSaveRevision] = useState(0);
  const pendingSaveRef = useRef(false);
  const dirtyRef = useRef(false);
  const eventSourceRef = useRef(null);
  const visualEditorRef = useRef(null);
  const savedSelectionRef = useRef(null);
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
    normalizeLinkTargets(editor);
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
      saveEditorSelection();
      return;
    }
    applyMarkdownShortcut(visualEditorRef.current);
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
    if (!ensureEditorSelection()) {
      setFloatingToolsOpen(false);
      return;
    }
    document.execCommand(command, false, value);
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
      setFloatingToolsOpen((value) => !value);
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
    if (!range) {
      setFloatingToolsOpen(false);
      return;
    }

    const code = document.createElement("code");
    if (range.collapsed) {
      code.textContent = "\u200b";
      range.insertNode(code);
      selectNodeContents(code);
    } else {
      const contents = range.extractContents();
      code.appendChild(contents);
      range.insertNode(code);
      const selection = window.getSelection();
      if (selection) {
        const nextRange = document.createRange();
        nextRange.selectNodeContents(code);
        selection.removeAllRanges();
        selection.addRange(nextRange);
        saveEditorSelection();
      }
    }
    handleVisualInput();
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
    document.execCommand("insertHTML", false, "<pre><code><br></code></pre>");
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

    const taskItem = currentTaskItem(editor);
    if (taskItem) {
      const nextTaskItem = createTaskListItem(false, "task");
      taskItem.insertAdjacentElement("afterend", nextTaskItem);
      placeCaretInsideTaskContent(nextTaskItem);
      handleVisualInput();
      setFloatingToolsOpen(false);
      return;
    }

    const currentBlock = currentBlockElement(editor);
    const list = document.createElement("ul");
    const item = createTaskListItem(false, "task");
    list.appendChild(item);

    if (currentBlock && currentBlock.parentNode) {
      const blockText = (currentBlock.textContent || "").trim();
      const isEmptyParagraph =
        ["P", "DIV"].includes(currentBlock.tagName) && blockText === "";

      if (isEmptyParagraph) {
        currentBlock.parentNode.replaceChild(list, currentBlock);
      } else {
        currentBlock.insertAdjacentElement("afterend", list);
      }
    } else {
      editor.appendChild(list);
    }

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
  const panelWidth = Math.min(192, viewportWidth - 32);
  const floatingPanelLeft = displayFloatingCorner.endsWith("left")
    ? floatingPosition.left
    : Math.max(16, floatingPosition.left + floatingButtonSize - panelWidth);
  const floatingPanelTop = (keyboardInset > 0 && cursorAlignedY !== null) || displayFloatingCorner.startsWith("bottom")
    ? Math.max(16, floatingPosition.top - 12 - 80)
    : floatingPosition.top + floatingButtonSize + 12;

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
            onPointerDown={handleVisualPointerDown}
            onPointerUp={() => { if (keyboardInset > 0) window.requestAnimationFrame(updateCursorAlignedY); }}
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
                <button type="button" className="toolbar-button" onPointerDown={handleToolbarPointerDown} onClick={() => runHistoryCommand("undo")}>
                  Undo
                </button>
                <button type="button" className="toolbar-button" onPointerDown={handleToolbarPointerDown} onClick={() => runHistoryCommand("redo")}>
                  Redo
                </button>
                <button type="button" className="toolbar-button" onPointerDown={handleToolbarPointerDown} onClick={() => applyCommand("formatBlock", "<h1>")}>
                  H1
                </button>
                <button type="button" className="toolbar-button" onPointerDown={handleToolbarPointerDown} onClick={() => applyCommand("formatBlock", "<h2>")}>
                  H2
                </button>
                <button type="button" className="toolbar-button" onPointerDown={handleToolbarPointerDown} onClick={() => applyCommand("bold")}>
                  B
                </button>
                <button type="button" className="toolbar-button" onPointerDown={handleToolbarPointerDown} onClick={() => applyCommand("italic")}>
                  I
                </button>
                <button type="button" className="toolbar-button" onPointerDown={handleToolbarPointerDown} onClick={insertInlineCode}>
                  Code
                </button>
                <button type="button" className="toolbar-button" onPointerDown={handleToolbarPointerDown} onClick={insertCodeBlock}>
                  Block
                </button>
                <button type="button" className="toolbar-button" onPointerDown={handleToolbarPointerDown} onClick={insertCheckbox}>
                  Check
                </button>
                <button type="button" className="toolbar-button" onPointerDown={handleToolbarPointerDown} onClick={() => applyCommand("insertUnorderedList")}>
                  List
                </button>
                <button type="button" className="toolbar-button" onPointerDown={handleToolbarPointerDown} onClick={() => applyCommand("formatBlock", "<blockquote>")}>
                  Quote
                </button>
              </aside>
            ) : null}
          </>
        ) : null}
      </section>
    </>
  );
}
