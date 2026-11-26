import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { cacheScope } from "./scope.mjs";

// Starts (or reuses) the local cache server for a worktree and returns the two variables
// that point Nx at it. The plugin calls it for a laptop, which goes through the cache gate
// with its GitHub token; CI runs it as a script from the nx-remote-cache action, so the
// role's credentials stay in the server's environment only.
const BUCKET = "langwatch-dev-nx-remote-cache";
const REGION = "eu-central-1";
const SERVER = fileURLToPath(new URL("./server.mjs", import.meta.url));

// What /health says about the server on that port: its pid and key, or null.
const health = async ({ port }) => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(500),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
};

const isServer = (answer, state) => answer?.pid === state.pid && answer?.key === state.key;

const readState = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

const stop = (pid) => {
  try {
    process.kill(pid);
  } catch {
    // Already gone.
  }
};

// The server's settings for this worktree and configuration. One server per
// configuration: a run on another branch starts its own and never stops one an earlier
// run still uses. The GitHub token stays out of the key and off disk.
export const serverConfig = ({ workspaceRoot, scope, gate = null, githubToken = null, env }) => {
  const dir = join(workspaceRoot, ".nx", "remote-cache");
  const bucket = env.LANGWATCH_NX_REMOTE_CACHE_BUCKET || BUCKET;
  const tokenHash = githubToken ? createHash("sha256").update(githubToken).digest("hex") : null;
  const key = createHash("sha256")
    .update(JSON.stringify({ scope, bucket, gate, tokenHash }))
    .digest("hex");
  return {
    scope,
    key,
    bucket,
    region: env.LANGWATCH_NX_REMOTE_CACHE_REGION || REGION,
    gate,
    token: randomBytes(24).toString("hex"),
    maxUploadBytes: Number(env.LANGWATCH_NX_REMOTE_CACHE_MAX_MB || 200) * 1024 * 1024,
    idleExitMs: 60 * 60_000,
    stateFile: join(dir, `server-${key.slice(0, 16)}.json`),
    logFile: join(dir, "server.log"),
  };
};

const logFileFor = (workspaceRoot) => join(workspaceRoot, ".nx", "remote-cache", "server.log");

export const ensureServer = async ({
  workspaceRoot,
  scope,
  gate = null,
  githubToken = null,
  env,
  serverEnv = env,
  serverPath = SERVER,
  startupPolls = 30,
}) => {
  const config = serverConfig({ workspaceRoot, scope, gate, githubToken, env });
  let state = readState(config.stateFile);
  if (state) {
    const answer = await health(state);
    if (isServer(answer, state)) return state;
    // Only a pid that answered as this server is signalled: after a reboot or a crash the
    // recorded one can belong to any process.
    if (answer?.pid === state.pid) stop(state.pid);
    rmSync(config.stateFile, { force: true });
  }
  const child = spawn(process.execPath, [serverPath], {
    detached: true,
    stdio: "ignore",
    env: {
      ...serverEnv,
      LANGWATCH_NX_REMOTE_CACHE_CONFIG: JSON.stringify(config),
      ...(githubToken ? { LANGWATCH_NX_REMOTE_CACHE_GITHUB_TOKEN: githubToken } : {}),
    },
  });
  child.on("error", () => {});
  child.unref();
  for (let i = 0; i < startupPolls; i++) {
    await new Promise((r) => setTimeout(r, 100));
    state = readState(config.stateFile);
    if (state?.pid === child.pid && isServer(await health(state), state)) return state;
  }
  if (child.pid) stop(child.pid);
  return null;
};

export const nxEnvironment = (state) => ({
  NX_SELF_HOSTED_REMOTE_CACHE_SERVER: `http://127.0.0.1:${state.port}`,
  NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN: state.token,
});

// The cache server's whole environment in CI: PATH and the role's session from
// NX_CACHE_AWS_*. Nothing else from the job reaches it, and no step ever sees AWS_*.
const ciServerEnv = (env) => ({
  PATH: env.PATH,
  AWS_ACCESS_KEY_ID: env.NX_CACHE_AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: env.NX_CACHE_AWS_SECRET_ACCESS_KEY,
  AWS_SESSION_TOKEN: env.NX_CACHE_AWS_SESSION_TOKEN,
  AWS_CREDENTIAL_EXPIRATION: env.NX_CACHE_AWS_CREDENTIAL_EXPIRATION,
});

// CI: starts the server and writes the Nx variables to $GITHUB_ENV, or nothing when this
// event has no cache scope or the server does not start.
export const ci = async ({ env, workspaceRoot, start = ensureServer, log = console.log }) => {
  const scope = cacheScope({ env });
  if (!scope) {
    log("This event gets no Nx remote cache.");
    return;
  }
  const state = await start({ workspaceRoot, scope, env, serverEnv: ciServerEnv(env) });
  if (!state) {
    log("The Nx remote cache server did not start; Nx keeps its local cache.");
    return;
  }
  const lines = Object.entries(nxEnvironment(state)).map(([k, v]) => `${k}=${v}`);
  appendFileSync(env.GITHUB_ENV, `${lines.join("\n")}\n`);
  log(
    `Nx remote cache on (${scope.tier}): reads ${scope.read.map((r) => r.prefix).join(", ")}; writes ${scope.write}.`,
  );
};

const ROUTINE = /^\S+ (listening on |used a laptop entry )/;

// The end-of-job report: the server log as it is, and one warning annotation when the
// cache failed requests, so a cache that only ever misses shows on the run page.
export const report = (text) => {
  const lines = text.split("\n").filter(Boolean);
  const failures = lines.filter((line) => !ROUTINE.test(line)).length;
  return [
    ...lines,
    ...(failures > 0
      ? [
          `::warning title=Nx remote cache::${failures} cache request(s) failed; the "Nx remote cache log" step has the details.`,
        ]
      : []),
  ];
};

const printReport = (workspaceRoot) => {
  let text = "";
  try {
    text = readFileSync(logFileFor(workspaceRoot), "utf8");
  } catch {
    return console.log("The Nx remote cache server wrote no log.");
  }
  for (const line of report(text)) console.log(line);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "report") printReport(process.cwd());
  else await ci({ env: process.env, workspaceRoot: process.cwd() });
}
