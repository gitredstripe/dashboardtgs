'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 10000;
const HOST = '0.0.0.0';
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const SNAP_FILE = path.join(DATA_DIR, 'snapshot.json');
const MAX_BYTES = 50 * 1024 * 1024;

const HTML_FILES = new Set(['/index.html', '/Tablero_por_Modulo_PF_Alpha_36.html']);

function send(res, status, body, headers) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        req.destroy();
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function getSnapshot(res) {
  if (!fs.existsSync(SNAP_FILE)) {
    send(res, 204, '');
    return;
  }
  const body = fs.readFileSync(SNAP_FILE);
  send(res, 200, body, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
}

async function putSnapshot(req, res) {
  let raw;
  try {
    raw = await readBody(req);
  } catch (err) {
    sendJson(res, err.status || 400, { ok: false, error: err.message || 'invalid body' });
    return;
  }
  if (!raw.length) {
    sendJson(res, 400, { ok: false, error: 'empty body' });
    return;
  }
  let snap;
  try {
    snap = JSON.parse(raw.toString('utf8'));
  } catch {
    sendJson(res, 400, { ok: false, error: 'invalid JSON' });
    return;
  }
  if (!snap || snap.app !== 'Tablero PF Alpha') {
    sendJson(res, 400, { ok: false, error: 'not a Tablero PF Alpha snapshot' });
    return;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = SNAP_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(snap));
  fs.renameSync(tmp, SNAP_FILE);
  sendJson(res, 200, { ok: true, generado: snap.generado || null });
}

function serveHtml(res, urlPath) {
  const file = urlPath === '/' ? 'index.html' : path.basename(urlPath);
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) {
    send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }
  send(res, 200, fs.readFileSync(full), {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  try {
    if (p === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (p === '/api/snapshot' && req.method === 'GET') {
      getSnapshot(res);
      return;
    }
    if (p === '/api/snapshot' && (req.method === 'PUT' || req.method === 'POST')) {
      await putSnapshot(req, res);
      return;
    }
    if (req.method === 'GET' && (p === '/' || HTML_FILES.has(p))) {
      serveHtml(res, p);
      return;
    }
    send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`dashboardtgs listening on http://${HOST}:${PORT}`);
});
