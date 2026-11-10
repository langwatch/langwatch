/**
 * pi pre-spawn check: warn and continue when the installed pi is older than the
 * extension was written against (ADR-188). Capture still works below it, so it never blocks.
 */

import { spawnSync } from "node:child_process";

import { compareVersions } from "../compare-versions";
import { lwTag } from "./brand";
import { isExecutableOnPath, shellLookupStdin } from "./tool-presence";
import { aliasShellFor } from "./wrapper-info-run";

const PROBE_TIMEOUT_MS = 2_000;
/** Printed before `pi --version` in the shell probe, so rc output never reads as the version. */
const VERSION_MARK = "__langwatch_pi_version__";

/** First pi release that emits `agent_settled`, which the extension's run span closes on. */
export const PI_MIN_VERSION = "0.80.5";

/** The x.y.z in `pi --version` output, or null when there is none. */
export function parsePiVersion(raw: string | null): string | null {
  if (!raw) return null;
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(raw);
  return match ? match[0] : null;
}

/**
 * Run `pi --version` (2s cap) as the launch resolves pi: on PATH directly (through the shell on
 * Windows, for npm's `.cmd` shim), else through the alias shell. Null on any failure.
 */
export function readInstalledVersion({ env = process.env }: { env?: NodeJS.ProcessEnv } = {}):
  | string
  | null {
  try {
    const options = { encoding: "utf8" as const, timeout: PROBE_TIMEOUT_MS, env };
    const aliasShell = isExecutableOnPath({ tool: "pi", env }) ? null : aliasShellFor(env);
    if (aliasShell === null) {
      const out =
        process.platform === "win32"
          ? spawnSync("pi --version", { ...options, shell: true })
          : spawnSync("pi", ["--version"], options);
      return parsePiVersion(out.stdout ?? null);
    }
    // Our own `pi` shell function would run `langwatch pi`; the launch unsets it too.
    const probe = `unset -f pi 2>/dev/null; printf '%s\\n' ${VERSION_MARK}; pi --version`;
    const out = spawnSync(aliasShell, ["-i", "-c", probe], {
      ...options,
      stdio: [shellLookupStdin(), "pipe", "ignore"],
    });
    const marked = (out.stdout ?? "").split(`${VERSION_MARK}\n`);
    return marked.length > 1 ? parsePiVersion(marked[marked.length - 1]!) : null;
  } catch {
    return null;
  }
}

/** The warnings for a `langwatch pi` run; empty when the version is fine or unknown. */
export function piPrespawnWarnings(opts: { readVersionImpl?: () => string | null } = {}): string[] {
  const version = (opts.readVersionImpl ?? (() => readInstalledVersion()))();
  if (!version || compareVersions({ version, against: PI_MIN_VERSION }) >= 0) return [];
  return [
    `${lwTag()} pi ${version} is older than ${PI_MIN_VERSION}; LangWatch capture may be incomplete. Upgrade pi for full capture.`,
  ];
}
