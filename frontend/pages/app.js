import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

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
    results.push({
      path: node.path,
      name: node.name
    });
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

function TreeNode({ node, onOpenNote, onRenameNote, onDeleteNote, depth = 0 }) {
  if (node.type === "note") {
    return (
      <article className="tree-note-row" style={{ paddingLeft: `${depth * 0.85}rem` }}>
        <button type="button" className="tree-note-main" onClick={() => onOpenNote(node.path)}>
          <strong>{node.name}</strong>
          <span>{node.path}</span>
        </button>
        <div className="tree-note-actions">
          <button type="button" className="secondary result-action-button" onClick={() => void onRenameNote(node.path)}>
            Rename
          </button>
          <button type="button" className="danger result-action-button" onClick={() => void onDeleteNote(node.path)}>
            Delete
          </button>
        </div>
      </article>
    );
  }

  const [isOpen, setIsOpen] = useState(node.path === "");

  return (
    <section className="tree-folder" style={{ paddingLeft: depth === 0 ? undefined : `${depth * 0.6}rem` }}>
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
        <div className="tree-folder-children">
          {(node.children || []).map((child) => (
            <TreeNode
              key={child.path || child.name}
              node={child}
              depth={node.path ? depth + 1 : depth}
              onOpenNote={onOpenNote}
              onRenameNote={onRenameNote}
              onDeleteNote={onDeleteNote}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default function AppPage() {
  const router = useRouter();
  const [vaultName, setVaultName] = useState("Vault Browser");
  const [status, setStatus] = useState("Loading notes...");
  const [query, setQuery] = useState("");
  const [tree, setTree] = useState(null);
  const [allNotes, setAllNotes] = useState([]);
  const [results, setResults] = useState([]);
  const [searchMode, setSearchMode] = useState(false);
  const [viewMode, setViewMode] = useState("list");

  useEffect(() => {
    let active = true;

    async function boot() {
      try {
        const auth = await api("/api/auth/status");
        if (!auth.authenticated) {
          router.replace("/login");
          return;
        }

        const [configPayload, notesPayload] = await Promise.all([
          api("/api/config"),
          api("/api/notes")
        ]);

        if (!active) {
          return;
        }

        const notes = flattenNotes(notesPayload.tree).sort((left, right) =>
          left.path.localeCompare(right.path)
        );

        setVaultName(configPayload.vaultName || "Vault Browser");
        setTree(notesPayload.tree);
        setAllNotes(notes);
        setResults(notes);
        setStatus(`${notes.length} notes available`);
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
  }, [router]);

  useEffect(() => {
    if (!query.trim()) {
      setSearchMode(false);
      setResults(allNotes);
      if (allNotes.length > 0) {
        setStatus(`${allNotes.length} notes available`);
      }
      return;
    }

    let active = true;
    const timeoutId = window.setTimeout(async () => {
      setSearchMode(true);
      setStatus("Searching...");
      try {
        const payload = await api(`/api/search?q=${encodeURIComponent(query.trim())}`);
        if (!active) {
          return;
        }
        setResults(payload.results);
        setStatus(`${payload.results.length} result${payload.results.length === 1 ? "" : "s"}`);
      } catch {
        if (active) {
          setStatus("Search failed");
        }
      }
    }, 200);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [allNotes, query]);

  async function createNote() {
    const proposedPath = window.prompt("New note path relative to the vault", "Inbox/new-note.md");
    if (!proposedPath) {
      return;
    }

    await api("/api/note", {
      method: "POST",
      body: JSON.stringify({
        path: proposedPath,
        content: `# ${proposedPath.split("/").pop().replace(/\.md$/i, "")}\n`
      })
    });

    router.push(`/note?path=${encodeURIComponent(proposedPath.replace(/\\/g, "/"))}`);
  }

  async function renameNote(notePath) {
    const proposedPath = window.prompt("Rename note", notePath);
    if (!proposedPath || proposedPath === notePath) {
      return;
    }

    await api("/api/note/rename", {
      method: "POST",
      body: JSON.stringify({
        from: notePath,
        to: proposedPath
      })
    });

    const notesPayload = await api("/api/notes");
    const notes = flattenNotes(notesPayload.tree).sort((left, right) =>
      left.path.localeCompare(right.path)
    );
    setTree(notesPayload.tree);
    setAllNotes(notes);
    setResults(notes);
    setStatus(`${notes.length} notes available`);
  }

  async function deleteNote(notePath) {
    if (!window.confirm(`Delete ${notePath}?`)) {
      return;
    }

    await api(`/api/note?path=${encodeURIComponent(notePath)}`, {
      method: "DELETE"
    });

    const notesPayload = await api("/api/notes");
    const notes = flattenNotes(notesPayload.tree).sort((left, right) =>
      left.path.localeCompare(right.path)
    );
    setTree(notesPayload.tree);
    setAllNotes(notes);
    setResults(notes);
    setStatus(`${notes.length} notes available`);
  }

  async function logout() {
    await api("/api/auth/logout", {
      method: "POST",
      body: JSON.stringify({})
    });
    router.replace("/login");
  }

  const subtitle = searchMode
    ? `${results.length} match${results.length === 1 ? "" : "es"} found`
    : "Select a note to open its dedicated editor view.";

  return (
    <>
      <Head>
        <title>{vaultName}</title>
      </Head>
      <section className="list-screen">
        <header className="topbar">
          <div>
            <h1>{vaultName}</h1>
            <p>{status}</p>
          </div>
          <div className="topbar-actions">
            <button type="button" onClick={createNote}>New Note</button>
            <button type="button" className="secondary" onClick={logout}>Lock</button>
          </div>
        </header>

        <section className="card list-panel">
          <label className="stack">
            <span>Find a note</span>
            <input
              type="search"
              placeholder="Search by file name or content"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="list-summary">
            <h2>{searchMode ? "Search Results" : "All Notes"}</h2>
            <p className="muted">{subtitle}</p>
          </div>
          {!searchMode ? (
            <div className="view-toggle-row">
              <button
                type="button"
                className={viewMode === "list" ? "chip-button active" : "chip-button"}
                onClick={() => setViewMode("list")}
              >
                List
              </button>
              <button
                type="button"
                className={viewMode === "tree" ? "chip-button active" : "chip-button"}
                onClick={() => setViewMode("tree")}
              >
                Tree
              </button>
            </div>
          ) : null}
          {results.length === 0 ? (
            <article className="empty-state">
              <h2>No notes found</h2>
              <p>Try a different search term or create a new note.</p>
            </article>
          ) : !searchMode && viewMode === "tree" && tree ? (
            <div className="tree-view">
              <TreeNode
                node={tree}
                onOpenNote={(notePath) => router.push(`/note?path=${encodeURIComponent(notePath)}`)}
                onRenameNote={renameNote}
                onDeleteNote={deleteNote}
              />
            </div>
          ) : (
            <div className="results-list">
              {results.map((item) => (
                <article
                  key={item.path}
                  className="result-item"
                >
                  <button
                    type="button"
                    className="result-main"
                    onClick={() => router.push(`/note?path=${encodeURIComponent(item.path)}`)}
                  >
                    <strong>{item.name}</strong>
                    <span>{item.path}</span>
                    {item.snippet ? <p>{item.snippet}</p> : null}
                  </button>
                  <div className="result-actions">
                    <button type="button" className="secondary result-action-button" onClick={() => void renameNote(item.path)}>
                      Rename
                    </button>
                    <button type="button" className="danger result-action-button" onClick={() => void deleteNote(item.path)}>
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </>
  );
}
