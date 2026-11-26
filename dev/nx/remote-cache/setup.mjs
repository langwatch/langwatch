import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { GATE_URL } from "./gate.mjs";

// One-time setup that `pnpm dev` and `haven up` run: the Nx remote cache needs a GitHub
// login (`gh auth token`). A logged-in machine hears nothing. A logged-out one in a
// terminal is asked to sign in once; whatever happens is remembered, so it is never asked
// again. It never fails and never stops dev: with no login the cache is off.

const OFF_LINE =
  "Nx remote cache is off: run gh auth login to share build results with CI (LANGWATCH_NX_REMOTE_CACHE=0 hides this).";
const NO_GH_LINE =
  "Nx remote cache is off: install the GitHub CLI (gh) and run gh auth login to share build results with CI.";

export const stateFile = (env) =>
  join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "langwatch", "nx-remote-cache.json");

// What to do: { action: "none" }, { action: "say", line } or { action: "login" }, with
// `remember` naming the state to keep so the next run stays quiet.
export const setupStep = ({ env, gate, ghInstalled, loggedIn, remembered, interactive }) => {
  if (env.LANGWATCH_NX_REMOTE_CACHE === "0" || env.CI || env.GITHUB_ACTIONS === "true")
    return { action: "none" };
  if (!gate) return { action: "none" };
  if (loggedIn) return { action: "none", remember: remembered === "on" ? undefined : "on" };
  if (remembered) return { action: "none" };
  if (!ghInstalled) return { action: "say", line: NO_GH_LINE, remember: "no-gh" };
  // No one to ask: say it, and ask the next time a person runs dev.
  if (!interactive) return { action: "say", line: OFF_LINE };
  return { action: "login" };
};

export const afterLogin = ({ loggedIn }) =>
  loggedIn
    ? { action: "none", remember: "on" }
    : { action: "say", line: OFF_LINE, remember: "declined" };

const readRemembered = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8")).state ?? null;
  } catch {
    return null;
  }
};

const remember = (file, state) => {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ state, at: new Date().toISOString() })}\n`);
  } catch {
    // Not remembering only means being asked again.
  }
};

const gh = (args, options = {}) => spawnSync("gh", args, { encoding: "utf8", ...options });

const loggedIn = () => {
  const out = gh(["auth", "token", "--hostname", "github.com"], { timeout: 5000 });
  return out.status === 0 && Boolean(out.stdout.trim());
};

const apply = (file, step) => {
  if (step.line) console.log(step.line);
  if (step.remember) remember(file, step.remember);
};

const main = () => {
  const env = process.env;
  const file = stateFile(env);
  const ghInstalled = gh(["--version"], { timeout: 5000 }).status === 0;
  const step = setupStep({
    env,
    gate: env.LANGWATCH_NX_REMOTE_CACHE_GATE ?? GATE_URL,
    ghInstalled,
    loggedIn: ghInstalled && loggedIn(),
    remembered: readRemembered(file),
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  });
  if (step.action !== "login") return apply(file, step);
  console.log(
    "Nx remote cache: sign in to GitHub once to reuse what CI already built (Ctrl-C skips).",
  );
  // Ctrl-C ends gh, not dev.
  process.on("SIGINT", () => {});
  gh(["auth", "login", "--web", "--hostname", "github.com", "--git-protocol", "https"], {
    stdio: "inherit",
    timeout: 5 * 60_000,
  });
  apply(file, afterLogin({ loggedIn: loggedIn() }));
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch {
    // Setup never stops dev.
  }
}
