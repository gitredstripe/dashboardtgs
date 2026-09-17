# Tablero TGS (dashboardtgs)

Single-page dashboard for Pruebas Funcionales, plus a tiny Node server that
keeps **one shared JSON snapshot** so every visitor sees the same board.

## Run locally

```bash
node server.js
```

Open `http://127.0.0.1:10000/`. **Guardar tablero** writes `/api/snapshot`.
**Descargar .json** / **Cargar archivo (.json)** are local backups.

## Render

This must be a **Web Service**, not a Static Site.

1. If a Static Site already exists for this repo, delete or suspend it (it cannot save).
2. [Render Dashboard](https://dashboard.render.com/) → **New → Web Service**.
3. Connect `gitredstripe/dashboardtgs`, branch `main`.
4. Runtime **Node**, build `npm install`, start `node server.js`.
5. Create Web Service. URL: `https://dashboardtgs.onrender.com` (or with a suffix).

Blueprint: `render.yaml`. Public URL = one shared board (no auth).

Disk is ephemeral on a basic Web Service: a **redeploy/restart can wipe** `data/snapshot.json`. Add a persistent disk and set `DATA_DIR` if you need the snapshot to survive deploys.
