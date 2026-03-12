# Obsidian Local Web

Phone-friendly browser access to a local Obsidian vault, with direct file editing and live updates.

## Features

- Password-protected access with a single configured password
- Direct reads and writes against your existing vault files
- Live update stream so browser content refreshes when the vault changes on disk
- Markdown editor plus preview
- Note tree, note search, note create, note rename, and note delete
- No SQL or NoSQL database required

## Setup

1. Copy `.env.example` to `.env`.
2. Set `VAULT_PATH` to your Obsidian vault directory.
3. Generate a password hash:

```bash
npm run hash-password -- "your-password"
```

4. Put the output into `APP_PASSWORD_HASH` in `.env`.
5. Start the server:

```bash
npm start
```

6. Open `http://<your-computer-ip>:3210` on your phone.

## Configuration

- `VAULT_PATH`: Absolute path to the vault root
- `APP_HOST`: Host binding, default `0.0.0.0`
- `APP_PORT`: Port, default `3210`
- `APP_PASSWORD_HASH`: Preferred password configuration
- `APP_PASSWORD`: Plain text fallback for local testing
- `SESSION_TTL_HOURS`: Session lifetime, default `24`

## Notes

- This is a zero-dependency MVP built on Node's built-in modules.
- Live updates use server-sent events plus vault polling for filesystem compatibility.
- File writes are atomic to reduce the chance of partial writes.
- The markdown renderer is intentionally lightweight and does not aim for full Obsidian compatibility.
