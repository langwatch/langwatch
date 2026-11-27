import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { GATE_URL } from "./gate.mjs";

// The check `pnpm dev` and `haven up` run: the Nx remote cache needs a GitHub login
// (`gh auth token`). A logged-in machine hears nothing. A logged-out one gets one line
// saying how to turn the cache on, once per person at a terminal. It never prompts, never
// waits and never fails: with no login the cache is off and dev starts as before.

const OFF_LINE =
  "Nx remote cache is off: run gh auth login to reuse what CI already built (LANGWATCH_NX_REMOTE_CACHE=0 hides this).";
const NO_GH_LINE =
  "Nx remote cache is off: install the GitHub CLI (gh) and run gh auth login to reuse what CI already built.";

export const stateFile = (env) =>
  join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "langwatch", "nx-remote-cache.json");

// What to do: { action: "none" } or { action: "say", line }, with `remember` naming the
// state to keep so the next run stays quiet.
export const setupStep = ({ env, gate, ghInstalled, loggedIn, remembered, interactive }) => {
  if (env.LANGWATCH_NX_REMOTE_CACHE === "0" || env.CI || env.GITHUB_ACTIONS === "true")
    return { action: "none" };
  if (!gate) return { action: "none" };
  if (loggedIn) return { action: "none", remember: remembered === "on" ? undefined : "on" };
  const line = ghInstalled ? OFF_LINE : NO_GH_LINE;
  // With no one at a terminal (an agent, a script), say it every time and remember nothing.
  if (!interactive) return { action: "say", line };
  if (remembered && remembered !== "on") return { action: "none" };
  return { action: "say", line, remember: ghInstalled ? "told" : "no-gh" };
};

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
    // Not remembering only means being told again.
  }
};

const gh = (args) => spawnSync("gh", args, { encoding: "utf8", timeout: 5000, stdio: "pipe" });

const main = () => {
  const env = process.env;
  const file = stateFile(env);
  const ghInstalled = gh(["--version"]).status === 0;
  const token = ghInstalled ? gh(["auth", "token", "--hostname", "github.com"]) : null;
  const step = setupStep({
    env,
    gate: env.LANGWATCH_NX_REMOTE_CACHE_GATE ?? GATE_URL,
    ghInstalled,
    loggedIn: token?.status === 0 && Boolean(token.stdout.trim()),
    remembered: readRemembered(file),
    interactive: Boolean(process.stdout.isTTY),
  });
  if (step.line) console.log(step.line);
  if (step.remember) remember(file, step.remember);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch {
    // Setup never stops dev.
  }
}
