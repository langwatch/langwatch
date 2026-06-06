/**
 * Persist the langwatch export block to the user's shell rc file
 * (~/.zshrc / ~/.bashrc / ~/.config/fish/config.fish) so a new
 * shell auto-picks up the gateway + OTLP env vars without running
 * `langwatch <tool>` as a wrapper.
 *
 * Spec for bug-bash item 1:
 *   1.2 — after login, OFFER to persist the export block. Y/n/never.
 *   1.3 — Remember choice. Stay quiet inside an already-configured
 *         shell (env already has the gateway vars set).
 *
 * Design notes:
 *   - The block is bracketed with marker comments so a second
 *     persist run is idempotent (regex replace, no duplicate
 *     blocks).
 *   - "never" persists `shell_rc_preference: "skip"` on the config
 *     so future logins on this machine stay quiet.
 *   - "not now" (n) does NOT persist — the next login re-asks. The
 *     in-shell quietness comes from the already-configured detect.
 *   - Detect "already configured" by checking process.env for both
 *     ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN. If either is
 *     present, assume the user already wired it up (via the rc
 *     file or by sourcing the export manually) and skip the
 *     prompt silently.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";

import chalk from "chalk";

import { type GovernanceConfig, saveConfig } from "./config";
import { envForTool, type ToolEnv } from "./wrapper";

/** Wrapped tools included in the union'd export block. */
const TOOLS = ["claude", "codex", "cursor", "gemini", "opencode"] as const;

const BLOCK_BEGIN = "# >>> langwatch begin >>>";
const BLOCK_END = "# <<< langwatch end <<<";

export type DetectedShell = "zsh" | "bash" | "fish";

/**
 * Best-effort shell detection from $SHELL. Falls back to zsh on
 * macOS (default since Catalina) and bash on Linux. Returns null
 * when running under an unsupported shell (cmd, powershell, etc.)
 * — the persist flow skips entirely in that case.
 */
export function detectShell(): DetectedShell | null {
  const raw = (process.env.SHELL ?? "").toLowerCase();
  if (raw.includes("fish")) return "fish";
  if (raw.includes("zsh")) return "zsh";
  if (raw.includes("bash")) return "bash";
  if (process.platform === "darwin") return "zsh";
  if (process.platform === "linux") return "bash";
  return null;
}

/** Returns the absolute path of the shell rc file. */
export function rcPath(shell: DetectedShell): string {
  const home = os.homedir();
  switch (shell) {
    case "zsh":
      return path.join(home, ".zshrc");
    case "bash":
      return path.join(home, ".bashrc");
    case "fish":
      return path.join(home, ".config", "fish", "config.fish");
  }
}

/**
 * Whether the current shell already has the gateway env vars
 * exported. If true the persist prompt stays quiet (per 1.3).
 */
export function isShellAlreadyConfigured(): boolean {
  return (
    !!process.env.ANTHROPIC_BASE_URL && !!process.env.ANTHROPIC_AUTH_TOKEN
  );
}

/**
 * Build the export-block body (without the begin/end markers) for
 * the given shell. Iterates the 5 wrapped tools and dedups env keys
 * so a multi-provider tool (cursor / opencode) doesn't repeat
 * OPENAI_* + ANTHROPIC_*.
 */
export function buildExportBlock(
  cfg: GovernanceConfig,
  shell: DetectedShell,
): string {
  const seen = new Set<string>();
  const entries: Array<[string, string]> = [];
  for (const tool of TOOLS) {
    const env: ToolEnv = envForTool(cfg, tool);
    for (const [k, v] of Object.entries(env.vars)) {
      if (seen.has(k)) continue;
      seen.add(k);
      entries.push([k, v]);
    }
  }
  const fmt =
    shell === "fish"
      ? ([k, v]: [string, string]) => `set -gx ${k} ${quote(v)}`
      : ([k, v]: [string, string]) => `export ${k}=${quote(v)}`;
  return entries.map(fmt).join("\n");
}

function quote(s: string): string {
  if (!/[ \t\n'"$\\]/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Append (or replace, if the marker block already exists) the
 * export block to the shell rc file. Creates the file if missing.
 * Idempotent: a second run replaces the block in place rather
 * than duplicating it.
 *
 * Returns the path that was written for the caller to surface.
 */
export function persistBlockToRc(
  shell: DetectedShell,
  block: string,
): string {
  const file = rcPath(shell);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const wrapped = `${BLOCK_BEGIN}\n${block}\n${BLOCK_END}\n`;

  let existing = "";
  try {
    existing = fs.readFileSync(file, "utf8");
  } catch {
    // ENOENT — fresh file
  }

  const marker = new RegExp(
    `${escapeRegex(BLOCK_BEGIN)}[\\s\\S]*?${escapeRegex(BLOCK_END)}\\n?`,
    "m",
  );
  let next: string;
  if (marker.test(existing)) {
    next = existing.replace(marker, wrapped);
  } else {
    const needsNewline = existing.length > 0 && !existing.endsWith("\n");
    next = existing + (needsNewline ? "\n" : "") + "\n" + wrapped;
  }
  fs.writeFileSync(file, next);
  return file;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Y/n/never prompt for stdin. Returns:
 *   - "yes" → append the block now
 *   - "no" → skip this login, re-ask next time
 *   - "never" → set shell_rc_preference=skip so we stay quiet forever
 *   - "skip" → non-TTY / closed stdin; do nothing
 */
export type PersistChoice = "yes" | "no" | "never" | "skip";

export async function askPersistChoice(
  rcPathHint: string,
): Promise<PersistChoice> {
  if (!process.stdin.isTTY) return "skip";

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ans = await new Promise<string>((resolve) => {
    rl.question(
      `Save the langwatch export block to ${rcPathHint}? [Y/n/never] `,
      (a) => resolve(a),
    );
  });
  rl.close();

  const norm = ans.trim().toLowerCase();
  if (norm === "" || norm === "y" || norm === "yes") return "yes";
  if (norm === "never") return "never";
  return "no";
}

/**
 * Ingestion-mode (Path B) variant of the shell-rc persist offer. Called
 * by the `langwatch <tool>` wrapper AFTER it resolves to ingestion mode,
 * so the user can install the tool's OTLP telemetry exports into their
 * shell rc. Once persisted, a plain `<tool>` invocation (without the
 * `langwatch` wrapper) inherits the OTEL_EXPORTER_OTLP_* env and captures
 * automatically — which is the whole point of "installing" the telemetry.
 *
 * Unlike the login-time gateway offer, this persists the exact OTEL env
 * the wrapper just computed for this run (`vars`), not the gateway block.
 * Y / n / never, same `shell_rc_preference=skip` opt-out. Stays quiet when
 * the shell already has the OTLP exporter env set.
 */
export async function maybeOfferIngestionShellRcPersist({
  cfg,
  tool,
  vars,
}: {
  cfg: GovernanceConfig;
  tool: string;
  vars: Record<string, string>;
}): Promise<void> {
  if (cfg.shell_rc_preference === "skip") return;
  // Already wired up — the OTLP exporter env is present in this shell.
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  const shell = detectShell();
  if (!shell) return;
  const entries = Object.entries(vars);
  if (entries.length === 0) return;

  const fmt =
    shell === "fish"
      ? ([k, v]: [string, string]) => `set -gx ${k} ${quote(v)}`
      : ([k, v]: [string, string]) => `export ${k}=${quote(v)}`;
  const block = entries.map(fmt).join("\n");

  const target = rcPath(shell);
  console.log();
  console.log(
    chalk.gray(
      `  Install telemetry so a plain \`${tool}\` (without \`langwatch\`) captures automatically.`,
    ),
  );
  const choice = await askPersistChoice(target);
  if (choice === "skip" || choice === "no") return;
  if (choice === "never") {
    cfg.shell_rc_preference = "skip";
    try {
      saveConfig(cfg);
    } catch {
      // best effort
    }
    return;
  }
  // "yes"
  try {
    const wrote = persistBlockToRc(shell, block);
    console.log(
      chalk.green(`  ✓ Installed langwatch telemetry exports to ${wrote}`),
    );
    console.log(
      chalk.gray(`  Open a new shell or run \`source ${wrote}\` to load it.`),
    );
  } catch (err) {
    console.log(
      chalk.yellow(`  ! Couldn't write to ${target}: ${(err as Error).message}`),
    );
  }
}
