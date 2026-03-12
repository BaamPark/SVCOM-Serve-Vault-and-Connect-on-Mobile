# Functional Requirements

## Product Goal

- [x] The system shall let a single user access an existing local Obsidian vault from a phone web browser over the same local network.
- [x] The system shall use the existing vault files as the primary source of truth.
- [x] The system shall allow changes made from the phone browser to be applied directly to the local vault files used by Obsidian on the desktop.

## User Access

- [x] The user shall be able to open the application from a phone browser using the server IP address and port.
- [x] The system shall be designed for a single user only.
- [x] The system shall require a password before allowing access to the vault from the browser.
- [x] The system shall keep the authentication flow simple for a single user rather than implementing full multi-user account management.
- [x] The system shall support access from devices on the same local network.

## Note Browsing

- [x] The system shall display the list of notes in the vault.
- [x] The system shall display folders in the vault.
- [x] The system shall let the user navigate folders and open notes.
- [x] The system shall show the note title or file name clearly in the UI.
- [x] The system shall support vault rescanning so newly added files appear in the browser.

## Note Reading

- [x] The system shall load the content of a selected Markdown note from the vault.
- [x] The system shall render a Markdown preview in the browser.
- [x] The system shall support Obsidian-style wikilinks as plain links or equivalent navigable links.
- [x] The system shall render local images and attachments referenced by notes when possible.

## Note Editing

- [x] The system shall let the user edit note content in the browser.
- [x] The system shall automatically save note changes back to the corresponding Markdown file in the vault without requiring a manual save action.
- [x] The system shall perform live-write behavior so browser edits are persisted during active editing.
- [x] The system shall prevent partial or corrupted file writes.
- [x] The system shall create new Markdown notes in the vault.
- [x] The system shall rename Markdown notes in the vault.
- [x] The system shall delete Markdown notes in the vault.
- [x] The system shall create folders in the vault.
- [x] The system shall rename folders in the vault.
- [x] The system shall delete folders in the vault.

## Real-Time Sync

- [x] The system shall detect file changes made directly by desktop Obsidian or other local edits.
- [x] The system shall perform live-read behavior so the phone browser updates when a note changes on disk.
- [x] The system shall update the phone browser when notes or folders are added, renamed, or deleted on disk.
- [x] The system shall write phone edits quickly enough that desktop Obsidian reflects them during normal use.
- [x] The system shall avoid requiring manual refresh to see note content changes during normal use.
- [x] The system shall handle basic write conflicts using a simple strategy such as last-write-wins.

## Search

- [x] The system shall let the user search notes by file name.
- [x] The system shall let the user search notes by content.
- [x] The system shall show search results with enough context to identify the correct note.

## Mobile UI

- [x] The system shall be usable from a phone-sized browser viewport.
- [x] The system shall provide a readable Markdown editing experience on mobile.
- [x] The system shall provide a readable Markdown preview experience on mobile.
- [x] The system shall allow quick switching between note list, editor, and preview.

## Server Behavior

- [x] The server shall read and write files directly in the configured vault path.
- [x] The server shall not require SQL or NoSQL storage for note contents.
- [x] The server shall expose HTTP endpoints for note and folder operations.
- [x] The server shall expose a real-time channel such as WebSocket for live updates.
- [x] The server shall validate requested paths so access stays inside the vault root.
- [x] The server shall log server errors and failed file operations.

## Security

- [x] The system shall avoid exposing the server to the public internet by default.
- [x] The system shall support binding the server to `0.0.0.0` or a specific local network interface.
- [x] The system shall support password-based access control.
- [x] The system shall avoid storing the password in plain text when a safer approach is practical.
- [x] The system shall reject unauthorized requests to note and folder APIs.

## Non-Functional Requirements

- [x] The system shall start on the desktop machine without requiring Obsidian Sync.
- [x] The system shall continue working while the desktop Obsidian app is open and using the same vault.
- [x] The system shall be simple enough to run and maintain for one user.
- [x] The system shall favor correctness of file updates over advanced collaboration features.

## Out of Scope For Initial Version

- [x] The initial version shall not require exact visual parity with the native Obsidian UI.
- [x] The initial version shall not require multi-user collaboration.
- [x] The initial version shall not require support for every Obsidian plugin feature.
- [x] The initial version shall not require graph view, canvas, or advanced workspace features.
