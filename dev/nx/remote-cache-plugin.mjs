import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { ensureServer, nxEnvironment } from "./remote-cache/launch.mjs";
import { cacheScope } from "./remote-cache/scope.mjs";

// Turns on the Nx remote cache in S3 for a laptop with the lw-dev-sso AWS profile
// (specs/ci/nx-remote-cache.feature). CI turns it on in the nx-remote-cache action instead.
// With no profile, or if anything here fails, Nx runs as before on its local cache.
export const name = "langwatch-remote-cache";

const DEFAULT_PROFILE = "lw-dev-sso";
let ownUrl = null;

const profileExists = ({ env, profile }) => {
  const file = env.AWS_CONFIG_FILE || join(homedir(), ".aws", "config");
  try {
    return readFileSync(file, "utf8")
      .split("\n")
      .some((line) => line.trim() === `[profile ${profile}]`);
  } catch {
    return false;
  }
};

const awsCliAvailable = () =>
  spawnSync("aws", ["--version"], { stdio: "ignore", timeout: 5000 }).status === 0;

// The AWS profile this run reads the cache with, or null for no remote cache.
export const profileFor = ({ env, profileExists: hasProfile, awsCli }) => {
  if (env.LANGWATCH_NX_REMOTE_CACHE === "0" || env.GITHUB_ACTIONS === "true") return null;
  const profile = env.LANGWATCH_NX_REMOTE_CACHE_PROFILE || DEFAULT_PROFILE;
  return hasProfile({ env, profile }) && awsCli() ? profile : null;
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
    const profile = profileFor({ env, profileExists, awsCli: awsCliAvailable });
    const scope = profile && cacheScope({ env, localBranch: currentBranch(context.workspaceRoot) });
    const state =
      scope && (await ensureServer({ workspaceRoot: context.workspaceRoot, scope, profile, env }));
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
