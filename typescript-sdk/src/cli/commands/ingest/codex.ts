/**
 * `langwatch ingest codex` — recover codex conversation content and post it as
 * trace content.
 *
 * Codex exports tokens, model and timing over OpenTelemetry and nothing a human
 * can read: the assistant reply is parsed out of the streaming response and
 * dropped before export, and no codex setting turns it back on. The conversation
 * does land on disk, in the session's append-only rollout transcript, where each
 * turn records the exact trace id codex used for that turn's spans.
 *
 * Sessions launched as `langwatch codex` already have that recovered by the
 * wrapper, which polls the transcript while the session runs. This command
 * serves the sessions the wrapper never sees — which, once capture is enabled,
 * is the normal case, because the point of enabling it is that a plain `codex`
 * captures. It runs in two modes:
 *
 *   --notify   codex ran us itself, right after a turn completed, and appended
 *              the turn payload naming the session. The everyday path.
 *   (default)  backfill: sweep transcripts already on disk, for sessions that
 *              ran before capture was switched on.
 */
import { spawn } from "node:child_process";

import chalk from "chalk";

import {
	codexOtelBlockAuthToken,
	codexOtelBlockEndpoint,
	defaultCodexConfigPath,
	displayCodexConfigPath,
} from "@/cli/utils/codex-config-toml";
import {
	harvestAndEmitCodexIO,
	harvestCodexThread,
} from "@/cli/utils/governance/codex-rollout-otlp";

/** Backfill window when the user names no other, in hours. */
const DEFAULT_BACKFILL_HOURS = 24;

/**
 * How far back to sweep when codex ran us but the payload was unreadable. Short
 * on purpose: the fallback exists so an unparseable payload still captures the
 * turn that just ended, not so it re-reads the user's whole history on a hook
 * that fires after every single turn.
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
 * Where the recovered content is posted, read back from the codex config the
 * user already enabled capture in. Null when capture is not on, which is the
 * honest answer: with no endpoint and key persisted, codex is not exporting
 * spans either, so there is no trace for this content to join.
 */
function resolveTarget(
	configPath: string,
): { endpoint: string; token: string } | null {
	const endpoint = codexOtelBlockEndpoint(configPath);
	const token = codexOtelBlockAuthToken(configPath);
	if (!endpoint || !token) return null;
	return { endpoint, token };
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
		const child = spawn(
			program,
			payload === undefined ? rest : [...rest, payload],
			{ detached: true, stdio: "ignore" },
		);
		child.unref();
	} catch {
		/* their program's problem must not become the coding session's */
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
	}

	const hours = options.since
		? Number.parseFloat(options.since)
		: DEFAULT_BACKFILL_HOURS;
	if (!options.all && (!Number.isFinite(hours) || hours <= 0)) {
		process.stderr.write(`Invalid --since: ${options.since}\n`);
		process.exit(1);
	}
	const nowMs = Date.now();
	const sinceMs = options.all ? 0 : nowMs - hours * 60 * 60 * 1000;

	let turns: number;
	try {
		turns = await harvestAndEmitCodexIO({ sinceMs, nowMs, ...target });
	} catch (err) {
		process.stderr.write(`Error: ${(err as Error).message}\n`);
		process.exit(1);
	}

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
		chalk.green(
			`✓ Recovered ${turns} codex turn${turns === 1 ? "" : "s"} onto their traces.`,
		),
	);
}

export async function ingestCodexCommand(
	options: IngestCodexOptions,
): Promise<void> {
	// `--notify` marks the codex-invoked path even when codex appended no
	// payload, so an empty value must not fall through to the chatty backfill.
	if (options.notify !== undefined || options.chain !== undefined) {
		await runNotifyMode(options);
		return;
	}
	await runBackfillMode(options);
}
