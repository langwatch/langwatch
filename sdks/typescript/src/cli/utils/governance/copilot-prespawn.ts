/**
 * Copilot pre-spawn checks: warn-and-continue for two conditions that make
 * telemetry silently incomplete (ADR-039 Decisions 8+9). Lives outside
 * preflightWrapper since copilot's default path is ingestion, not gateway.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { compareVersions } from "../compare-versions";
import { lwTag } from "./brand";

/** First copilot version whose OTel attribute set matches the extractor. */
export const COPILOT_MIN_OTEL_VERSION = "1.0.41";

/**
 * Device-level managed-settings locations per platform. Exported for the
 * logout/telemetry-targets symmetry check and tests.
 */
export function copilotManagedSettingsPaths(
  platform: NodeJS.Platform = process.platform,
): string[] {
  switch (platform) {
    case "darwin":
      return ["/Library/Application Support/GitHubCopilot/managed-settings.json"];
    case "win32": {
      const programData = process.env.ProgramData ?? "C:\\ProgramData";
      return [path.join(programData, "GitHubCopilot", "managed-settings.json")];
    }
    default:
      return ["/etc/github-copilot/policy.d"];
  }
}

/**
 * Whether a managed-settings file (or policy.d document) pins OTel config.
 * A plain substring probe for "otel" keeps this robust to schema evolution
 * while never flagging a file that only manages permissions.
 */
function fileMentionsOtel(filePath: string): boolean {
  try {
    return fs.readFileSync(filePath, "utf8").toLowerCase().includes("otel");
  } catch {
    return false;
  }
}

/**
 * Detect a device-level managed OTel pin. Returns the offending path, or
 * null when none found. Directories (policy.d) are scanned one level deep
 * for .json documents.
 */
export function detectManagedOtelPin(
  paths: string[] = copilotManagedSettingsPaths(),
): string | null {
  for (const p of paths) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(p);
    } catch {
      continue;
    }
    if (stat.isFile()) {
      if (fileMentionsOtel(p)) return p;
      continue;
    }
    if (!stat.isDirectory()) continue;
    const pinned = findDirEntries(p)
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => path.join(p, entry))
      .find((full) => fileMentionsOtel(full));
    if (pinned) return pinned;
  }
  return null;
}

function findDirEntries(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Parse the version out of `copilot --version` output
 * ("GitHub Copilot CLI 1.0.69." or a bare "1.0.69"). Null when
 * unparseable — the caller treats that as "don't warn, don't block".
 */
export function parseCopilotVersion(raw: string | null): string | null {
  if (!raw) return null;
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(raw);
  return match ? match[0] : null;
}

/** Run `copilot --version` (2s cap). Null on any failure — never block. */
function readInstalledVersion(): string | null {
  try {
    const out = spawnSync("copilot", ["--version"], {
      encoding: "utf8",
      timeout: 2_000,
    });
    return parseCopilotVersion(out.stdout ?? null);
  } catch {
    return null;
  }
}

export interface CopilotPrespawnOptions {
  /** Version-read seam for tests. Defaults to `copilot --version`. */
  readVersionImpl?: () => string | null;
  /** Managed-settings paths seam for tests. */
  managedPaths?: string[];
}

/**
 * Compute the pre-spawn warnings for a `langwatch copilot` run. Pure
 * with respect to the resolved path: takes no mode input, so gateway and
 * ingestion runs surface the same warnings. Empty array = all clear.
 */
export function copilotPrespawnWarnings(opts: CopilotPrespawnOptions = {}): string[] {
  const warnings: string[] = [];

  const pinned = detectManagedOtelPin(opts.managedPaths);
  if (pinned) {
    warnings.push(
      `${lwTag()} enterprise policy (${pinned}) routes copilot telemetry elsewhere; LangWatch capture may be incomplete.`,
    );
  }

  const version = (opts.readVersionImpl ?? readInstalledVersion)();
  if (version && compareVersions({ version, against: COPILOT_MIN_OTEL_VERSION }) < 0) {
    warnings.push(
      `${lwTag()} copilot ${version} exports incomplete telemetry attributes; upgrade to ${COPILOT_MIN_OTEL_VERSION}+ (\`copilot update\`) for full capture.`,
    );
  }

  return warnings;
}

/**
 * Gateway mode routes copilot through BYOK provider env, and GitHub
 * requires COPILOT_MODEL for BYOK -- without it copilot fails opaquely.
 * Returns an actionable message when no model resolves, else null.
 */
export function copilotGatewayModelPreflight(opts: {
  args: string[];
  env: Record<string, string | undefined>;
}): string | null {
  const hasModel =
    !!opts.env.COPILOT_MODEL ||
    !!opts.env.COPILOT_PROVIDER_MODEL_ID ||
    opts.args.some((a) => a === "--model" || a.startsWith("--model="));
  if (hasModel) return null;
  return "gateway mode needs a model — GitHub Copilot's BYOK path requires one. Re-run with `--model <id>` or set COPILOT_MODEL.";
}
