/**
 * pi pre-spawn check: warn and continue when the installed pi is older than the
 * extension was written against (ADR-188). Capture still works below it, so it never blocks.
 */

import { spawnSync } from "node:child_process";

import { compareVersions } from "../compare-versions";
import { lwTag } from "./brand";

/** First pi release that emits `agent_settled`, which the extension's run span closes on. */
export const PI_MIN_VERSION = "0.80.5";

/** The x.y.z in `pi --version` output, or null when there is none. */
export function parsePiVersion(raw: string | null): string | null {
  if (!raw) return null;
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(raw);
  return match ? match[0] : null;
}

/** Run `pi --version` (2s cap). Null on any failure, so the run is never held up. */
function readInstalledVersion(): string | null {
  try {
    const out = spawnSync("pi", ["--version"], { encoding: "utf8", timeout: 2_000 });
    return parsePiVersion(out.stdout ?? null);
  } catch {
    return null;
  }
}

/** The warnings for a `langwatch pi` run; empty when the version is fine or unknown. */
export function piPrespawnWarnings(opts: { readVersionImpl?: () => string | null } = {}): string[] {
  const version = (opts.readVersionImpl ?? readInstalledVersion)();
  if (!version || compareVersions({ version, against: PI_MIN_VERSION }) >= 0) return [];
  return [
    `${lwTag()} pi ${version} is older than ${PI_MIN_VERSION}; LangWatch capture may be incomplete. Upgrade pi for full capture.`,
  ];
}
