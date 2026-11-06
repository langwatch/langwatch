/**
 * Whether a wrapped tool can start at all, asked before the wrapper writes
 * anything: a run that ends in "not found" must leave no config, rc block,
 * hook file or extension behind.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { SHELL_FUNCTION_TOOLS } from "./shell-rc";
import { aliasShellFor } from "./wrapper-info-run";

/** Past this the shell lookup is abandoned and the tool counts as found. */
const SHELL_LOOKUP_TIMEOUT_MS = 10_000;

/** Single-quote a string for safe interpolation into a `sh -c` command. */
const shellQuote = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;

/**
 * The stdin a shell lookup gets: the terminal when the launch shell will have it, so an rc that
 * defines aliases only on a TTY answers the lookup as it answers the launch.
 */
export const shellLookupStdin = (
  stdin: { isTTY?: boolean } = process.stdin,
): "inherit" | "ignore" => (stdin.isTTY ? "inherit" : "ignore");

/** PATH's directories; on POSIX an empty entry is the current directory, as the shell reads it. */
function pathDirs({ env, cwd }: { env: NodeJS.ProcessEnv; cwd: string }): string[] {
  const entries = (env.PATH ?? "").split(path.delimiter);
  if (process.platform === "win32") return entries.filter(Boolean);
  return entries.map((entry) => (entry === "" ? cwd : entry));
}

/** Whether an executable named `tool` sits in one of PATH's directories. */
export function isExecutableOnPath({
  tool,
  env = process.env,
  cwd = process.cwd(),
}: {
  tool: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}): boolean {
  const dirs = pathDirs({ env, cwd });
  const extensions =
    process.platform === "win32"
      ? ["", ...(env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)]
      : [""];
  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = path.join(dir, `${tool}${extension}`);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
      } catch {
        continue;
      }
    }
  }
  return false;
}

/**
 * Whether the tool resolves as a session resolves it: PATH, then the alias shell (theirs
 * counts, our scoped function does not). A shell that fails to answer counts as found.
 */
export function isToolResolvable({
  tool,
  env = process.env,
}: {
  tool: string;
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (isExecutableOnPath({ tool, env })) return true;
  const aliasShell = aliasShellFor(env);
  if (!aliasShell) return false;
  const unsetOurs = SHELL_FUNCTION_TOOLS.includes(tool) ? `unset -f ${tool} 2>/dev/null; ` : "";
  const lookup = spawnSync(
    aliasShell,
    ["-i", "-c", `${unsetOurs}command -v -- ${shellQuote(tool)} >/dev/null 2>&1`],
    { stdio: [shellLookupStdin(), "ignore", "ignore"], env, timeout: SHELL_LOOKUP_TIMEOUT_MS },
  );
  if (lookup.error || lookup.status === null) return true;
  return lookup.status === 0;
}
