# Tablero TGS (dashboardtgs)

Single-page dashboard plus a tiny Node server. The shared board is
`data/snapshot.json` in git (`main`).

## Run locally

```bash
node server.js
```

Open `http://127.0.0.1:10000/`. The page embeds `data/snapshot.json` (and
also fetches `/api/snapshot`) so every visitor sees the last save.
**Guardar tablero** PUTs that file and git-pushes it. **Cargar archivo (.json)**
applies a local file **and then saves it to the shared URL**.

## Render — Web Service only

A **Static Site cannot do this** (no server, no git push). Use a Web Service.

1. If a Static Site exists for this repo, delete or suspend it.
2. [Render Dashboard](https://dashboard.render.com/) → **New → Web Service**.
3. Connect `gitredstripe/dashboardtgs`, branch `main`.
4. Runtime **Node**, build `npm install`, start `node server.js`.
5. Environment → **Add**:
   - **Key:** `GITHUB_TOKEN` (or `GH_TOKEN`)
   - **Value:** a GitHub personal access token with **repo** access (or fine-grained **Contents: Read and write** on `gitredstripe/dashboardtgs`)
6. Create / deploy the Web Service.

Without that env var, Guardar still writes the file on the instance disk and
returns an error that git push needs the token. Redeploys would lose that copy.

Public URL = one shared board (no auth).
