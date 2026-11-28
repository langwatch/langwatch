import { spawnSync } from "node:child_process";

import { GATE_URL } from "./remote-cache/gate.mjs";
import { ensureServer, nxEnvironment } from "./remote-cache/launch.mjs";
import { cacheScope } from "./remote-cache/scope.mjs";

// Turns on the Nx remote cache for a laptop with a GitHub login (`gh auth token`), through
// the cache gate (specs/ci/nx-remote-cache.feature). CI turns it on in the nx-remote-cache
// action instead. With no login, or if anything here fails, Nx runs on its local cache.
export const name = "langwatch-remote-cache";

let ownUrl = null;

const githubCliToken = () => {
  const out = spawnSync("gh", ["auth", "token", "--hostname", "github.com"], {
    encoding: "utf8",
    timeout: 5000,
  });
  return out.status === 0 && out.stdout.trim() ? out.stdout.trim() : null;
};

// The gate and token this run reads the cache with, or null for no remote cache.
export const laptopAccess = ({ env, githubToken }) => {
  if (env.LANGWATCH_NX_REMOTE_CACHE === "0" || env.GITHUB_ACTIONS === "true") return null;
  const gate = env.LANGWATCH_NX_REMOTE_CACHE_GATE ?? GATE_URL;
  if (!gate) return null;
  const token = githubToken();
  return token ? { gate, githubToken: token } : null;
};

const currentBranch = (root) => {
  const out = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    timeout: 5000,
  });
  return out.status === 0 ? out.stdout.trim() : null;
};

export const preTasksExecution = async (_options, context) => {
  const env = process.env;
  if (env.NX_SELF_HOSTED_REMOTE_CACHE_SERVER && env.NX_SELF_HOSTED_REMOTE_CACHE_SERVER !== ownUrl)
    return;
  try {
    const access = laptopAccess({ env, githubToken: githubCliToken });
    const scope = access && cacheScope({ env, localBranch: currentBranch(context.workspaceRoot) });
    const state =
      scope &&
      (await ensureServer({ workspaceRoot: context.workspaceRoot, scope, env, ...access }));
    if (!state) {
      if (ownUrl) delete env.NX_SELF_HOSTED_REMOTE_CACHE_SERVER;
      ownUrl = null;
      return;
    }
    const vars = nxEnvironment(state);
    ownUrl = vars.NX_SELF_HOSTED_REMOTE_CACHE_SERVER;
    Object.assign(env, vars);
  } catch {
    // Any failure leaves Nx on its local cache.
  }
};
