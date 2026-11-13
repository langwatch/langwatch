import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Variables that point an agent's or the CLI's config outside HOME. While one
 * is set (a Claude Code session sets CLAUDE_CONFIG_DIR), a test that moves HOME
 * to a temp directory would still write the developer's real files.
 */
export const CONFIG_LOCATION_VARS = [
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  "COPILOT_HOME",
  "GROK_HOME",
  "PI_CODING_AGENT_DIR",
  "XDG_CONFIG_HOME",
  "LANGWATCH_CLI_CONFIG",
  "LANGWATCH_CONFIG_DIR",
  "LANGWATCH_DAEMON_DIR",
] as const;

/** The temp homes' name prefix. */
export const TEST_HOME_PREFIX = "lw-home-";

/**
 * Points HOME (and USERPROFILE) at a fresh temp directory and drops every
 * config location variable; returns the temp home. It sits under /tmp, not a
 * long TMPDIR, so the daemon's socket path stays within sockaddr_un.
 */
export const isolateHome = (env: NodeJS.ProcessEnv): string => {
  const realHome = env.HOME;
  const base = process.platform === "win32" ? os.tmpdir() : "/tmp";
  const home = fs.mkdtempSync(path.join(base, TEST_HOME_PREFIX));
  if (realHome && path.resolve(home) === path.resolve(realHome)) {
    throw new Error(`tests must not run with the real HOME (${realHome})`);
  }
  for (const name of CONFIG_LOCATION_VARS) delete env[name];
  env.HOME = home;
  env.USERPROFILE = home;
  return home;
};
