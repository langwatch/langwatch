/**
 * Copilot pre-spawn checks — mode-independent warnings for the two
 * conditions that make copilot telemetry silently incomplete (ADR-039
 * Decisions 8 + 9). Both are warn-and-continue: the user keeps working,
 * support keeps an explanation for "copilot shows nothing".
 *
 *   1. Enterprise-managed settings can pin an OTel collector org-wide;
 *      managed values WIN over the env vars the wrapper injects, so the
 *      user's telemetry flows to the enterprise collector instead of
 *      LangWatch. Device-level managed settings live at fixed paths
 *      (verified against the copilot 1.0.69 native runtime):
 *        macOS:  /Library/Application Support/GitHubCopilot/managed-settings.json
 *                (plus MDM profiles under the com.github.copilot domain,
 *                not file-detectable)
 *        linux:  /etc/github-copilot/policy.d/*.json
 *      There is ALSO a server layer fetched from GitHub's
 *      /copilot_internal/managed_settings with the user's auth at run
 *      time — that one cannot be preflighted from disk, so this check
 *      covers the device layer only (documented in ADR-039).
 *
 *   2. Copilot CLI below 1.0.41 exports a different, incomplete OTel
 *      attribute set — warn to upgrade, never block (copilot
 *      auto-updates; a hard gate would be stricter than any other
 *      wrapped tool).
 *
 * These checks live OUTSIDE preflightWrapper on purpose: preflight only
 * runs on the gateway branch, and copilot's default path is ingestion
 * (wrapper-path-choice.ts), so gateway-only placement would skip the
 * warnings on the majority of runs.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

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
      return [
        "/Library/Application Support/GitHubCopilot/managed-settings.json",
      ];
    case "win32": {
      const programData = process.env.ProgramData ?? "C:\\ProgramData";
      return [
        path.join(programData, "GitHubCopilot", "managed-settings.json"),
      ];
    }
    default:
      return ["/etc/github-copilot/policy.d"];
  }
}

/**
 * Whether a managed-settings file (or policy.d document) pins OTel
 * config. Key names observed in the 1.0.69 bundle's managed shape:
 * `enabled`, `endpoint`, `protocol`, `headers`, `captureContent`,
 * `lockCaptureContent`, `serviceName` under an otel section — a plain
 * substring probe for "otel" keeps this robust to schema evolution
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
    if (stat.isDirectory()) {
      let entries: string[];
      try {
        entries = fs.readdirSync(p);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        const full = path.join(p, entry);
        if (fileMentionsOtel(full)) return full;
      }
    }
  }
  return null;
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

/** Simple semver-triple comparison: negative when a < b. */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
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
export function copilotPrespawnWarnings(
  opts: CopilotPrespawnOptions = {},
): string[] {
  const warnings: string[] = [];

  const pinned = detectManagedOtelPin(opts.managedPaths);
  if (pinned) {
    warnings.push(
      `${lwTag()} enterprise policy (${pinned}) routes copilot telemetry elsewhere; LangWatch capture may be incomplete.`,
    );
  }

  const version = (opts.readVersionImpl ?? readInstalledVersion)();
  if (version && compareVersions(version, COPILOT_MIN_OTEL_VERSION) < 0) {
    warnings.push(
      `${lwTag()} copilot ${version} exports incomplete telemetry attributes; upgrade to ${COPILOT_MIN_OTEL_VERSION}+ (\`copilot update\`) for full capture.`,
    );
  }

  return warnings;
}
