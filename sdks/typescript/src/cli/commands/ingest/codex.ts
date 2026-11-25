/**
 * Recover codex conversation content from session transcripts and post as trace
 * content. Two modes: --notify (real-time after turns) or backfill (sweep disk).
 */
import { spawn } from "node:child_process";

import chalk from "chalk";

import {
  codexOtelBlockAuthToken,
  codexOtelBlockEndpoint,
  codexOtelBlockLogsEndpoint,
  defaultCodexConfigPath,
  displayCodexConfigPath,
} from "@/cli/utils/codex-config-toml";
import { GovernanceCliError } from "@/cli/utils/governance/cli-api";
import {
  harvestAndEmitCodexIO,
  harvestCodexThread,
} from "@/cli/utils/governance/codex-rollout-otlp";

/** Backfill window when the user names no other, in hours. */
const DEFAULT_BACKFILL_HOURS = 24;

/**
 * How far back to sweep when the payload was unreadable. Short on purpose:
 * the fallback captures the turn that just ended, not the user's whole
 * history, on a hook that fires after every turn.
 */
const NOTIFY_FALLBACK_MS = 30 * 60 * 1000;

export interface IngestCodexOptions {
  /** Turn payload codex appended after a completed turn. */
  notify?: string;
  /** JSON argv of a user-authored notify program we displaced and must still run. */
  chain?: string;
  /** Backfill window in hours. */
  since?: string;
  /** Backfill everything on disk rather than a window. */
  all?: boolean;
  json?: boolean;
}

/** The turn-completion payload codex hands its notify program. */
interface TurnCompletePayload {
  "thread-id"?: unknown;
}

/**
 * Where recovered content is posted, read from the codex config capture was
 * enabled in. Null when capture isn't on: with no endpoint/key persisted,
 * codex isn't exporting spans either, so there's no trace to join.
 */
function resolveTarget(configPath: string): {
  endpoint: string;
  logsEndpoint: string | null;
  token: string;
} | null {
  const endpoint = codexOtelBlockEndpoint(configPath);
  const token = codexOtelBlockAuthToken(configPath);
  if (!endpoint || !token) return null;
  return {
    endpoint,
    logsEndpoint: codexOtelBlockLogsEndpoint(configPath),
    token,
  };
}

function threadIdFrom(payload: string): string | null {
  try {
    const parsed = JSON.parse(payload) as TurnCompletePayload;
    const threadId = parsed["thread-id"];
    return typeof threadId === "string" && threadId ? threadId : null;
  } catch {
    return null;
  }
}

/**
 * Run the notify program we displaced when we took codex's single notify slot,
 * handed the same payload codex would have handed it. Detached and unwaited:
 * their program's runtime is theirs, and codex is not waiting on us either.
 */
function runChained(chain: string, payload: string | undefined): void {
  let argv: unknown;
  try {
    argv = JSON.parse(chain);
  } catch {
    return;
  }
  if (!Array.isArray(argv) || argv.length === 0) return;
  const [program, ...rest] = argv as string[];
  if (typeof program !== "string" || !program) return;
  try {
    const child = spawn(program, payload === undefined ? rest : [...rest, payload], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch {
    /* their program's problem must not become the coding session's */
    void 0;
  }
}

/**
 * The turn-completion path. Everything here is swallowed: codex runs this after
 * every turn of every session, and a telemetry hook that can interrupt, slow or
 * noise up a coding session is worse than one that misses a turn.
 */
async function runNotifyMode(options: IngestCodexOptions): Promise<void> {
  const payload = options.notify;
  try {
    const target = resolveTarget(defaultCodexConfigPath());
    if (target) {
      const threadId = payload ? threadIdFrom(payload) : null;
      const nowMs = Date.now();
      if (threadId) {
        await harvestCodexThread({ threadId, nowMs, ...target });
      } else {
        // No readable payload: fall back to the recently-written transcripts
        // so the turn that just ended is still captured.
        await harvestAndEmitCodexIO({
          sinceMs: nowMs - NOTIFY_FALLBACK_MS,
          nowMs,
          ...target,
        });
      }
    }
  } catch {
    /* never surface a harvest failure into a coding session */
    void 0;
  } finally {
    if (options.chain) runChained(options.chain, payload);
  }
}

async function runBackfillMode(options: IngestCodexOptions): Promise<void> {
  const configPath = defaultCodexConfigPath();
  const target = resolveTarget(configPath);
  if (!target) {
    process.stderr.write(
      `Codex capture is not enabled in ${displayCodexConfigPath()}.\n` +
        "Run `langwatch codex` once to set it up, then re-run this command.\n",
    );
    process.exit(1);
    // `process.exit` is typed `never`, but a test that stubs it is not, and
    // without this the function runs on and reports a result it never got.
    return;
  }

  const hours = options.since ? Number.parseFloat(options.since) : DEFAULT_BACKFILL_HOURS;
  if (!options.all && (!Number.isFinite(hours) || hours <= 0)) {
    process.stderr.write(`Invalid --since: ${options.since}\n`);
    process.exit(1);
    return;
  }
  const nowMs = Date.now();
  const sinceMs = options.all ? 0 : nowMs - hours * 60 * 60 * 1000;

  let turns: number;
  try {
    turns = await harvestAndEmitCodexIO({ sinceMs, nowMs, ...target });
  } catch (err) {
    // Reaching the server is not the same as landing the content: a refused
    // upload arrives here too, and is reported rather than counted.
    const msg = err instanceof GovernanceCliError ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
    return;
  }

  reportBackfill({ options, turns, hours, sinceMs });
}

function reportBackfill({
  options,
  turns,
  hours,
  sinceMs,
}: {
  options: IngestCodexOptions;
  turns: number;
  hours: number;
  sinceMs: number;
}): void {
  if (options.json) {
    console.log(JSON.stringify({ turns, since: options.all ? null : sinceMs }));
    return;
  }
  if (turns === 0) {
    console.log(
      options.all
        ? "No codex sessions found on disk."
        : `No codex turns in the last ${hours} hour(s).`,
    );
    return;
  }
  console.log(
    chalk.green(`✓ Recovered ${turns} codex turn${turns === 1 ? "" : "s"} onto their traces.`),
  );
}

export async function ingestCodexCommand(options: IngestCodexOptions): Promise<void> {
  // `--notify` marks the codex-invoked path even when codex appended no
  // payload, so an empty value must not fall through to the chatty backfill.
  if (options.notify !== undefined || options.chain !== undefined) {
    await runNotifyMode(options);
    return;
  }
  await runBackfillMode(options);
}
