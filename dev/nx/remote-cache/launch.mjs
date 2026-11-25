import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { cacheScope } from "./scope.mjs";

// Starts (or reuses) the local cache server for a worktree and returns the two variables
// that point Nx at it. The plugin calls it for a laptop; CI runs it as a script from the
// nx-remote-cache action, so the role's credentials stay in the server's environment only.
export const BUCKET = "langwatch-dev-nx-remote-cache";
export const REGION = "eu-central-1";
const SERVER = fileURLToPath(new URL("./server.mjs", import.meta.url));

const healthy = async ({ port }) => {
  try {
    return (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) }))
      .ok;
  } catch {
    return false;
  }
};

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

export const ensureServer = async ({ workspaceRoot, scope, profile, env, serverEnv = env }) => {
  const dir = join(workspaceRoot, ".nx", "remote-cache");
  const bucket = env.LANGWATCH_NX_REMOTE_CACHE_BUCKET || BUCKET;
  const key = createHash("sha256").update(JSON.stringify({ scope, bucket, profile })).digest("hex");
  // One server per configuration: a run on another branch starts its own and never stops
  // a server an earlier run still uses. Idle servers exit on their own.
  const stateFile = join(dir, `server-${key.slice(0, 16)}.json`);
  let state = readState(stateFile);
  if (state?.key === key && (await healthy(state))) return state;
  if (state?.pid) stop(state.pid);
  const config = {
    scope,
    key,
    bucket,
    region: env.LANGWATCH_NX_REMOTE_CACHE_REGION || REGION,
    profile,
    token: randomBytes(24).toString("hex"),
    maxUploadBytes: Number(env.LANGWATCH_NX_REMOTE_CACHE_MAX_MB || 200) * 1024 * 1024,
    idleExitMs: 60 * 60_000,
    stateFile,
    logFile: join(dir, "server.log"),
  };
  const child = spawn(process.execPath, [SERVER], {
    detached: true,
    stdio: "ignore",
    env: { ...serverEnv, LANGWATCH_NX_REMOTE_CACHE_CONFIG: JSON.stringify(config) },
  });
  child.unref();
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 100));
    state = readState(stateFile);
    if (state?.pid === child.pid && (await healthy(state))) return state;
  }
  stop(child.pid);
  return null;
};

export const nxEnvironment = (state) => ({
  NX_SELF_HOSTED_REMOTE_CACHE_SERVER: `http://127.0.0.1:${state.port}`,
  NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN: state.token,
});

// CI: credentials come in NX_CACHE_AWS_*; only the server gets them as AWS_*. Writes the
// Nx variables to $GITHUB_ENV, or nothing when this event has no cache scope.
const ci = async () => {
  const env = process.env;
  const scope = cacheScope({ env });
  if (!scope) return console.log("This event gets no Nx remote cache.");
  const serverEnv = {
    PATH: env.PATH,
    AWS_ACCESS_KEY_ID: env.NX_CACHE_AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: env.NX_CACHE_AWS_SECRET_ACCESS_KEY,
    AWS_SESSION_TOKEN: env.NX_CACHE_AWS_SESSION_TOKEN,
  };
  const state = await ensureServer({
    workspaceRoot: process.cwd(),
    scope,
    profile: null,
    env,
    serverEnv,
  });
  if (!state)
    return console.log("The Nx remote cache server did not start; Nx keeps its local cache.");
  const lines = Object.entries(nxEnvironment(state)).map(([k, v]) => `${k}=${v}`);
  appendFileSync(env.GITHUB_ENV, `${lines.join("\n")}\n`);
  console.log(
    `Nx remote cache on (${scope.tier}): reads ${scope.read.map((r) => r.prefix).join(", ")}; writes ${scope.write}.`,
  );
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await ci();
