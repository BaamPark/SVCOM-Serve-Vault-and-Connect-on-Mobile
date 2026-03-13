# Obsidian Local Web

Separated frontend and backend for browser access to a local Obsidian vault, with direct file editing and live updates.

## Layout

- `frontend/`: Next.js app running on port `3000`
- `backend/`: Node.js vault API running on port `3210`
- `docker-compose.yml`: two-container setup with the frontend proxying `/api` to the backend

## Features

- Next.js multi-page frontend for login, note search, and dedicated note editing
- Separate backend service for vault access, auth, search, and live updates
- Password-protected access with a single configured password
- Direct reads and writes against your existing vault files
- Live update stream so browser content refreshes when the vault changes on disk
- Markdown editor plus preview
- Note search, note create, note rename, and note delete
- No SQL or NoSQL database required

## Local Run

1. Keep your root `.env` file with the backend settings:

```bash
npm run hash-password -- "your-password"
```

2. Put the output into `APP_PASSWORD_HASH` in `.env`.
3. Install frontend dependencies:

```bash
cd frontend
npm install
```

4. Run the backend in one terminal:

```bash
cd backend
npm run dev
```

5. Run the frontend in a second terminal:

```bash
cd frontend
npm run dev
```

6. Open `http://<your-computer-ip>:3100` on your phone.

The frontend proxies `/api` requests to the backend, so you only browse to port `3100`.

## Docker

1. Set these variables in the root `.env` or your shell:

- `HOST_VAULT_PATH`: host path to your vault for the Docker volume mount
- `APP_PASSWORD_HASH` or `APP_PASSWORD`

2. Start both services:

```bash
docker compose up --build
```

3. Open `http://<your-computer-ip>:3100`.

## Configuration

- `VAULT_PATH`: Absolute path to the vault root
- `APP_HOST`: Host binding, default `0.0.0.0`
- `APP_PORT`: Port, default `3210`
- `APP_PASSWORD_HASH`: Preferred password configuration
- `APP_PASSWORD`: Plain text fallback for local testing
- `SESSION_TTL_HOURS`: Session lifetime, default `24`
- `BACKEND_ORIGIN`: frontend-only setting, default `http://localhost:3210`

## Notes

- The frontend is a standalone Next.js app.
- The backend is a standalone Node.js service.
- The vault APIs remain file-based and do not use a database.
- Live updates use server-sent events plus vault polling for filesystem compatibility.
- File writes are atomic to reduce the chance of partial writes.
- The markdown renderer is intentionally lightweight and does not aim for full Obsidian compatibility.
