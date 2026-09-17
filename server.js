'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = Number(process.env.PORT) || 10000;
const HOST = '0.0.0.0';
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const SNAP_FILE = path.join(DATA_DIR, 'snapshot.json');
const SNAP_REL = 'data/snapshot.json';
const MAX_BYTES = 50 * 1024 * 1024;
const GITHUB_REPO = process.env.GITHUB_REPO || 'gitredstripe/dashboardtgs';
const HTML_FILES = new Set(['/index.html', '/Tablero_por_Modulo_PF_Alpha_36.html']);

const NO_TOKEN_ERROR =
  'Snapshot saved on this server disk only. Set GITHUB_TOKEN (or GH_TOKEN) on the Render Web Service so Guardar can git push data/snapshot.json to main. A Static Site cannot persist or push — use a Web Service.';

function gitToken() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
}

function redact(s) {
  const tok = gitToken();
  let out = String(s || '');
  if (tok) out = out.split(tok).join('***');
  return out.replace(/x-access-token:[^@\s]+/g, 'x-access-token:***').slice(0, 400);
}

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

function runGit(args, extraEnv) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd: ROOT,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(extraEnv || {}) },
        timeout: 60000,
        maxBuffer: 8 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (err) {
          err.stdout = stdout;
          err.stderr = stderr;
          err.message = redact(stderr || stdout || err.message);
          reject(err);
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

function identArgs() {
  const name = process.env.GIT_AUTHOR_NAME || 'dashboardtgs';
  const email = process.env.GIT_AUTHOR_EMAIL || 'dashboardtgs@users.noreply.github.com';
  return ['-c', `user.name=${name}`, '-c', `user.email=${email}`];
}

function authedRemote(token) {
  return `https://x-access-token:${token}@github.com/${GITHUB_REPO}.git`;
}

async function persistViaGithubApi(token) {
  const api = `https://api.github.com/repos/${GITHUB_REPO}/contents/${SNAP_REL.split(path.sep).join('/')}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dashboardtgs',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  let sha;
  const got = await fetch(`${api}?ref=main`, { headers });
  if (got.ok) {
    const j = await got.json();
    sha = j.sha;
  } else if (got.status !== 404) {
    const t = await got.text();
    throw new Error(`GitHub contents GET failed (${got.status}): ${redact(t)}`);
  }
  const put = await fetch(api, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Update shared dashboard snapshot',
      content: fs.readFileSync(SNAP_FILE).toString('base64'),
      branch: 'main',
      ...(sha ? { sha } : {}),
    }),
  });
  if (!put.ok) {
    const t = await put.text();
    throw new Error(`GitHub contents PUT failed (${put.status}): ${redact(t)}`);
  }
}

async function persistViaGitCli(token) {
  const remote = authedRemote(token);
  await runGit(['add', '--', SNAP_REL]);
  const st = (await runGit(['status', '--porcelain', '--', SNAP_REL])).stdout.trim();
  if (!st) return;

  await runGit([...identArgs(), 'commit', '-m', 'Update shared dashboard snapshot']);

  try {
    await runGit(['fetch', remote, 'main']);
    try {
      await runGit(['rebase', 'FETCH_HEAD']);
    } catch {
      try {
        await runGit(['checkout', '--theirs', '--', SNAP_REL]);
        await runGit(['add', '--', SNAP_REL]);
        await runGit(['-c', 'core.editor=true', ...identArgs(), 'rebase', '--continue']);
      } catch (err2) {
        await runGit(['rebase', '--abort']).catch(() => {});
        throw err2;
      }
    }
  } catch (err) {
    const msg = `${err.stderr || ''} ${err.stdout || ''} ${err.message || ''}`;
    if (!/couldn't find remote ref|unknown revision|no such ref|couldn't find/i.test(msg)) {
      // continue to push; empty main is first snapshot
    }
  }
  await runGit(['push', remote, 'HEAD:main']);
}

async function persistToGit() {
  const token = gitToken();
  if (!token) {
    return { ok: false, error: NO_TOKEN_ERROR };
  }
  const hasGit = fs.existsSync(path.join(ROOT, '.git'));
  try {
    if (hasGit) await persistViaGitCli(token);
    else await persistViaGithubApi(token);
    return { ok: true };
  } catch (err) {
    if (hasGit) {
      try {
        await persistViaGithubApi(token);
        return { ok: true, via: 'api-fallback' };
      } catch (err2) {
        return { ok: false, error: `git push failed: ${redact(err2.message || err.message)}` };
      }
    }
    return { ok: false, error: `git push failed: ${redact(err.message)}` };
  }
}

let putChain = Promise.resolve();
function enqueuePut(fn) {
  const run = putChain.then(fn, fn);
  putChain = run.catch(() => {});
  return run;
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

  const git = await persistToGit();
  if (!git.ok) {
    sendJson(res, 503, {
      ok: false,
      savedToDisk: true,
      error: git.error,
    });
    return;
  }
  sendJson(res, 200, { ok: true, git: true, generado: snap.generado || null });
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
      await enqueuePut(() => putSnapshot(req, res));
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
