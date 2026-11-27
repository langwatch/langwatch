import { appendFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

import { credentialSource } from "./credentials.mjs";
import { gateStore } from "./gate.mjs";
import { getObject, putObject } from "./s3.mjs";
import { writePrefixFor } from "./scope.mjs";

// Nx's self-hosted HTTP cache (NX_SELF_HOSTED_REMOTE_CACHE_SERVER) in front of S3. Nx fails
// the run when this server errors, so every S3 problem is a miss on read and a silent
// skip on write: the remote cache only ever makes a run faster.
const HASH = /^\/v1\/cache\/([A-Za-z0-9]+)$/;

// The first namespace that holds the hash, in the scope's read order.
const findEntry = async ({ scope, store, hash, log }) => {
  await store.prepare?.(scope.read.map((read) => `${read.prefix}${hash}`)).catch(() => {});
  for (const read of scope.read) {
    const key = `${read.prefix}${hash}`;
    const hit = await store.get(key).catch((error) => {
      log(`get ${key}: ${error.message}`);
      return null;
    });
    if (hit) return { hit, read, key };
  }
  return null;
};

const answerAfterBody = (req, res) => {
  if (req.complete) return void res.writeHead(200).end();
  req.on("end", () => res.writeHead(200).end());
  req.on("error", () => res.destroy());
  req.resume();
};

const uploadable = ({ prefix, length, maxUploadBytes }) =>
  Boolean(prefix) && Number.isFinite(length) && length > 0 && length <= maxUploadBytes;

// A pull request's later jobs restore their GitHub Actions caches, which can hold laptop
// output this server never served. So the taint is a marker object in the branch's own
// namespace: once one job used a laptop entry, every later job of that branch is tainted.
const taintKeyFor = (scope) =>
  scope.taintedWrite && scope.taintedWrite !== scope.write ? `${scope.taintedWrite}tainted` : null;

const writeMarker = ({ store, key }) =>
  store.put(key, Readable.from([Buffer.from("1")]), 1, { overwrite: true }).catch(() => 0);

const loadTaint = (ctx) => {
  const { scope, state, store } = ctx;
  state.loaded ??= (async () => {
    const key = taintKeyFor(scope);
    if (!key) return;
    // A marker that cannot be read counts as present: an unknown taint never writes pr/.
    const hit = await store.get(key).catch(() => ({ body: Readable.from([]) }));
    if (!hit) return;
    hit.body.resume();
    state.tainted = true;
    state.markerStored = (await writeMarker({ store, key })) === 200;
  })();
  return state.loaded;
};

// A laptop entry is served only once the branch's marker is stored, so a later job can
// never miss the taint. If the marker cannot be stored, the entry is a miss.
const mayServe = async (ctx, found) => {
  const { scope, state, store, log } = ctx;
  const key = taintKeyFor(scope);
  if (!found.read.laptop || !key || state.markerStored) return true;
  state.tainted = true;
  state.markerStored = (await writeMarker({ store, key })) === 200;
  if (state.markerStored)
    log(`used a laptop entry (${found.key}); this branch no longer writes ${scope.write}`);
  return state.markerStored;
};

const serveGet = async (ctx, hash, res) => {
  const found = await findEntry({ ...ctx, hash });
  if (!found) return void res.writeHead(404).end();
  if (!(await mayServe(ctx, found))) {
    found.hit.body.resume();
    return void res.writeHead(404).end();
  }
  const { length, body } = found.hit;
  res.writeHead(200, {
    "content-type": "application/octet-stream",
    ...(length ? { "content-length": length } : {}),
  });
  body.on("error", () => res.destroy());
  body.pipe(res);
};

const servePut = async (ctx, hash, req, res) => {
  const { scope, state, store, maxUploadBytes, log } = ctx;
  await loadTaint(ctx);
  const prefix = writePrefixFor({ scope, tainted: state.tainted });
  const length = Number(req.headers["content-length"]);
  if (!uploadable({ prefix, length, maxUploadBytes })) return answerAfterBody(req, res);
  const key = `${prefix}${hash}`;
  const status = await store.put(key, req, length).catch((error) => {
    log(`put ${key}: ${error.message}`);
    return 0;
  });
  if (status !== 200 && status !== 412) log(`put ${key}: S3 answered ${status}`);
  answerAfterBody(req, res);
};

const route = (ctx, token, id) => (req, res) => {
  if (req.url === "/health")
    return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(id));
  const match = HASH.exec(req.url ?? "");
  if (!match) return res.writeHead(404).end();
  if (req.headers.authorization !== `Bearer ${token}`) return res.writeHead(401).end();
  if (req.method === "GET") return void serveGet(ctx, match[1], res);
  if (req.method === "PUT") return void servePut(ctx, match[1], req, res);
  return res.writeHead(405).end();
};

// /health answers the pid and key, so the launcher can tell its own server from whatever
// else holds a port it once recorded.
export const createCacheServer = ({
  scope,
  token,
  store,
  maxUploadBytes,
  log = () => {},
  id = {},
}) =>
  createServer(route({ scope, store, maxUploadBytes, log, state: { tainted: false } }, token, id));

// An S3 GET answer as a store read: the object, null for an object that is not there,
// or a thrown error for anything else, which a read takes as a miss and the taint marker
// as present. The cache roles have no s3:ListBucket, so a missing key answers 403.
export const s3Read = (res) => {
  if (res.statusCode === 200) return { body: res, length: res.headers["content-length"] };
  res.resume();
  if (res.statusCode === 404 || res.statusCode === 403) return null;
  throw new Error(`S3 answered ${res.statusCode}`);
};

const s3Store = ({ bucket, region, credentials }) => ({
  get: async (key) => {
    const creds = await credentials();
    if (!creds) throw new Error("no AWS credentials");
    return s3Read(await getObject({ bucket, region, credentials: creds, key }));
  },
  put: async (key, body, length, { overwrite = false } = {}) => {
    const creds = await credentials();
    if (!creds) return 0;
    return putObject({ bucket, region, credentials: creds, key, body, length, overwrite });
  },
});

const fileLogger = (file) => (line) => {
  try {
    appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // A log that cannot be written is not worth failing a cache request for.
  }
};

// Started detached by launch.mjs with its settings in LANGWATCH_NX_REMOTE_CACHE_CONFIG.
// It writes its port to the state file once listening and exits after an idle hour.
const main = () => {
  const config = JSON.parse(process.env.LANGWATCH_NX_REMOTE_CACHE_CONFIG ?? "{}");
  delete process.env.LANGWATCH_NX_REMOTE_CACHE_CONFIG;
  const log = fileLogger(config.logFile);
  // A laptop goes through the cache gate with its GitHub token; CI signs with its role.
  const githubToken = process.env.LANGWATCH_NX_REMOTE_CACHE_GITHUB_TOKEN;
  delete process.env.LANGWATCH_NX_REMOTE_CACHE_GITHUB_TOKEN;
  const store = config.gate
    ? gateStore({ url: config.gate, token: githubToken, log })
    : s3Store({
        bucket: config.bucket,
        region: config.region,
        credentials: credentialSource({ env: process.env }),
      });
  const server = createCacheServer({
    scope: config.scope,
    token: config.token,
    store,
    maxUploadBytes: config.maxUploadBytes,
    log,
    id: { pid: process.pid, key: config.key },
  });
  let idle;
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => process.exit(0), config.idleExitMs).unref();
  };
  server.on("request", touch);
  server.listen(0, "127.0.0.1", () => {
    touch();
    const { port } = server.address();
    const state = { port, pid: process.pid, key: config.key, token: config.token };
    mkdirSync(dirname(config.stateFile), { recursive: true });
    writeFileSync(`${config.stateFile}.tmp`, JSON.stringify(state), { mode: 0o600 });
    renameSync(`${config.stateFile}.tmp`, config.stateFile);
    log(
      `listening on ${port} for ${config.scope.tier}, writing ${config.scope.write ?? "nothing"}`,
    );
  });
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
