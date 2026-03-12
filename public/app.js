const state = {
  authenticated: false,
  tree: null,
  selectedPath: "",
  editorDirty: false,
  pendingSave: null,
  currentUpdatedAt: 0,
  eventSource: null
};

const elements = {
  loginScreen: document.getElementById("login-screen"),
  mainScreen: document.getElementById("main-screen"),
  loginForm: document.getElementById("login-form"),
  passwordInput: document.getElementById("password-input"),
  loginError: document.getElementById("login-error"),
  vaultName: document.getElementById("vault-name"),
  statusText: document.getElementById("status-text"),
  notesTree: document.getElementById("notes-tree"),
  searchInput: document.getElementById("search-input"),
  searchResults: document.getElementById("search-results"),
  noteTitle: document.getElementById("note-title"),
  notePath: document.getElementById("note-path"),
  editorInput: document.getElementById("editor-input"),
  previewOutput: document.getElementById("preview-output"),
  newNoteButton: document.getElementById("new-note-button"),
  renameNoteButton: document.getElementById("rename-note-button"),
  deleteNoteButton: document.getElementById("delete-note-button"),
  logoutButton: document.getElementById("logout-button")
};

async function api(path, options = {}) {
  const response = await fetch(path, {
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

function showLogin(errorMessage = "") {
  state.authenticated = false;
  closeEvents();
  elements.loginScreen.hidden = false;
  elements.mainScreen.hidden = true;
  elements.loginError.hidden = !errorMessage;
  elements.loginError.textContent = errorMessage;
  elements.passwordInput.value = "";
  elements.passwordInput.focus();
}

function showMain() {
  elements.loginScreen.hidden = true;
  elements.mainScreen.hidden = false;
}

function debounce(fn, waitMs) {
  let timeoutId = null;
  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => fn(...args), waitMs);
  };
}

function updateStatus(text) {
  elements.statusText.textContent = text;
}

function renderTreeNode(node) {
  if (!node.children) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tree-note${state.selectedPath === node.path ? " active" : ""}`;
    button.textContent = node.name;
    button.addEventListener("click", () => {
      void openNote(node.path);
    });
    return button;
  }

  const wrapper = document.createElement("div");
  const label = document.createElement("div");
  label.className = "tree-folder-label";
  label.textContent = node.path ? node.name : "Vault";
  wrapper.appendChild(label);

  const folder = document.createElement("div");
  folder.className = "tree-folder";
  for (const child of node.children) {
    folder.appendChild(renderTreeNode(child));
  }
  wrapper.appendChild(folder);
  return wrapper;
}

function renderTree() {
  elements.notesTree.innerHTML = "";
  if (!state.tree) {
    return;
  }
  elements.notesTree.appendChild(renderTreeNode(state.tree));
}

function renderPreview(html) {
  elements.previewOutput.innerHTML = html || '<p class="muted">No preview available.</p>';
  elements.previewOutput.querySelectorAll("[data-note-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const target = decodeURIComponent(link.dataset.noteLink || "");
      void openLinkedNote(target);
    });
  });
}

function noteNameFromPath(notePath) {
  if (!notePath) {
    return "Select a note";
  }
  const parts = notePath.split("/");
  return parts[parts.length - 1];
}

function setSelectedNoteMetadata(notePath) {
  state.selectedPath = notePath;
  elements.noteTitle.textContent = noteNameFromPath(notePath);
  elements.notePath.textContent = notePath || "No note selected";
  renderTree();
}

async function loadTree() {
  const payload = await api("/api/notes");
  state.tree = payload.tree;
  renderTree();
}

async function loadConfig() {
  const payload = await api("/api/config");
  elements.vaultName.textContent = payload.vaultName || "Vault Browser";
}

async function openNote(notePath) {
  if (!notePath) {
    return;
  }

  const payload = await api(`/api/note?path=${encodeURIComponent(notePath)}`);
  setSelectedNoteMetadata(payload.path);
  elements.editorInput.value = payload.content;
  renderPreview(payload.html);
  state.currentUpdatedAt = payload.updatedAt || Date.now();
  state.editorDirty = false;
  updateStatus("Live sync connected");
}

async function openLinkedNote(linkTarget) {
  if (!state.tree) {
    return;
  }

  const target = linkTarget.endsWith(".md") ? linkTarget : `${linkTarget}.md`;
  const notePath = findNotePath(state.tree, target);
  if (notePath) {
    await openNote(notePath);
  }
}

function findNotePath(node, targetPath) {
  if (node.type === "note" && node.path.endsWith(targetPath)) {
    return node.path;
  }

  if (!node.children) {
    return "";
  }

  for (const child of node.children) {
    const match = findNotePath(child, targetPath);
    if (match) {
      return match;
    }
  }

  return "";
}

const saveNoteDebounced = debounce(async () => {
  if (!state.selectedPath) {
    return;
  }

  const content = elements.editorInput.value;
  state.pendingSave = api("/api/note", {
    method: "PUT",
    body: JSON.stringify({
      path: state.selectedPath,
      content
    })
  });

  try {
    updateStatus("Saving...");
    const payload = await state.pendingSave;
    renderPreview(payload.html);
    state.currentUpdatedAt = payload.updatedAt || Date.now();
    state.editorDirty = false;
    updateStatus("Live sync connected");
  } catch (error) {
    updateStatus(`Save failed: ${error.message}`);
  } finally {
    state.pendingSave = null;
  }
}, 500);

async function refreshSelectedNoteIfNeeded(changedPaths, deletedPaths) {
  if (!state.selectedPath) {
    return;
  }

  if (deletedPaths.includes(state.selectedPath)) {
    state.selectedPath = "";
    elements.editorInput.value = "";
    renderPreview('<p class="muted">This note was deleted.</p>');
    setSelectedNoteMetadata("");
    return;
  }

  if (changedPaths.includes(state.selectedPath) && !state.editorDirty && !state.pendingSave) {
    await openNote(state.selectedPath);
  }
}

function connectEvents() {
  closeEvents();
  const events = new EventSource("/api/events");
  events.onopen = () => updateStatus("Live sync connected");
  events.onerror = () => updateStatus("Live sync reconnecting...");
  events.onmessage = async (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type !== "vault_changed") {
        return;
      }
      await loadTree();
      await refreshSelectedNoteIfNeeded(payload.changedPaths || [], payload.deletedPaths || []);
    } catch (error) {
      updateStatus(`Live sync error: ${error.message}`);
    }
  };
  state.eventSource = events;
}

function closeEvents() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
}

const runSearchDebounced = debounce(async () => {
  const query = elements.searchInput.value.trim();
  if (!query) {
    elements.searchResults.hidden = true;
    elements.searchResults.innerHTML = "";
    return;
  }

  const payload = await api(`/api/search?q=${encodeURIComponent(query)}`);
  elements.searchResults.hidden = false;
  elements.searchResults.innerHTML = "";

  for (const result of payload.results) {
    const card = document.createElement("div");
    card.className = "search-result";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = result.path;
    button.addEventListener("click", () => {
      void openNote(result.path);
      elements.searchResults.hidden = true;
      elements.searchResults.innerHTML = "";
      elements.searchInput.value = "";
    });
    const snippet = document.createElement("p");
    snippet.textContent = result.snippet || "Filename match";
    card.append(button, snippet);
    elements.searchResults.appendChild(card);
  }
}, 250);

async function createNote() {
  const proposedPath = window.prompt("New note path relative to the vault", "Inbox/new-note.md");
  if (!proposedPath) {
    return;
  }

  await api("/api/note", {
    method: "POST",
    body: JSON.stringify({
      path: proposedPath,
      content: `# ${noteNameFromPath(proposedPath).replace(/\.md$/i, "")}\n`
    })
  });
  await loadTree();
  await openNote(proposedPath.replace(/\\/g, "/"));
}

async function renameNote() {
  if (!state.selectedPath) {
    return;
  }
  const proposedPath = window.prompt("Rename note", state.selectedPath);
  if (!proposedPath || proposedPath === state.selectedPath) {
    return;
  }

  const payload = await api("/api/note/rename", {
    method: "POST",
    body: JSON.stringify({
      from: state.selectedPath,
      to: proposedPath
    })
  });
  await loadTree();
  await openNote(payload.path);
}

async function deleteNote() {
  if (!state.selectedPath) {
    return;
  }
  if (!window.confirm(`Delete ${state.selectedPath}?`)) {
    return;
  }
  await api(`/api/note?path=${encodeURIComponent(state.selectedPath)}`, { method: "DELETE" });
  state.selectedPath = "";
  elements.editorInput.value = "";
  renderPreview('<p class="muted">Select a note.</p>');
  setSelectedNoteMetadata("");
  await loadTree();
}

async function logout() {
  await api("/api/auth/logout", {
    method: "POST",
    body: JSON.stringify({})
  });
  showLogin();
}

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: elements.passwordInput.value })
    });
    await initializeApp();
  } catch (error) {
    showLogin(error.message);
  }
});

elements.editorInput.addEventListener("input", () => {
  state.editorDirty = true;
  updateStatus("Editing...");
  saveNoteDebounced();
});

elements.searchInput.addEventListener("input", () => {
  void runSearchDebounced();
});

elements.newNoteButton.addEventListener("click", () => {
  void createNote();
});

elements.renameNoteButton.addEventListener("click", () => {
  void renameNote();
});

elements.deleteNoteButton.addEventListener("click", () => {
  void deleteNote();
});

elements.logoutButton.addEventListener("click", () => {
  void logout();
});

async function initializeApp() {
  state.authenticated = true;
  showMain();
  await Promise.all([loadConfig(), loadTree()]);
  renderPreview('<p class="muted">Select a note to preview it here.</p>');
  connectEvents();
}

async function boot() {
  try {
    const status = await api("/api/auth/status");
    if (!status.authenticated) {
      showLogin();
      return;
    }
    await initializeApp();
  } catch (error) {
    showLogin();
  }
}

void boot();
