/**
 * Emit codex turn input/output (recovered from the rollout transcript) as OTLP
 * spans on codex's own per-turn trace_ids, so they join the native token-spans
 * and the trace summary's computed input/output populate with no receiver
 * change. See codex-rollout.ts for why the transcript is the only content
 * source codex offers.
 */
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { GovernanceCliError } from "./cli-api";
import { type CodexTurnIO, parseCodexRollout } from "./codex-rollout";

/** Deterministic 16-hex span id derived from the turn's trace_id. */
function ioSpanId(traceId: string): string {
  return createHash("sha256").update(`${traceId}:langwatch.io`).digest("hex").slice(0, 16);
}

function attr(key: string, value: string) {
  return { key, value: { stringValue: value } };
}

interface OtlpExportRequest {
  resourceSpans: unknown[];
}

/**
 * Build an OTLP/JSON ExportTraceServiceRequest with one span per turn. Each
 * span rides codex's real trace_id and carries `langwatch.input` /
 * `langwatch.output` (read directly by the trace-summary IO accumulation) plus
 * `langwatch.span.type=llm` so the drawer renders it as the model response.
 *
 * `langwatch.input` is the full request body as the LangWatch structured
 * `chat_messages` envelope (system prompt + accumulated conversation + tool
 * calls). The receiver's `parseJsonStringValues` step parses the JSON string
 * into the `{ type, value }` object, and the LangWatch extractor canonicalises
 * it to `gen_ai.input.messages` + `gen_ai.system_instructions`, so the drawer
 * renders the same full conversation a claude trace does.
 */
export function buildCodexIOExportRequest(
  turns: CodexTurnIO[],
  nowMs: number,
): OtlpExportRequest {
  const spans = turns.map((turn) => {
    const startMs = turn.startedAtMs ?? nowMs;
    const endMs = Math.max(startMs, nowMs);
    const attributes = [
      attr("langwatch.span.type", "llm"),
      attr(
        "langwatch.input",
        JSON.stringify({ type: "chat_messages", value: turn.inputMessages }),
      ),
      attr("langwatch.output", turn.output),
    ];
    if (turn.model) {
      attributes.push(attr("gen_ai.request.model", turn.model));
      attributes.push(attr("gen_ai.response.model", turn.model));
    }
    return {
      traceId: turn.traceId,
      spanId: ioSpanId(turn.traceId),
      name: "codex.turn.response",
      kind: 1,
      startTimeUnixNano: `${startMs}000000`,
      endTimeUnixNano: `${endMs}000000`,
      attributes,
      status: {},
    };
  });

  return {
    resourceSpans: [
      {
        resource: { attributes: [attr("service.name", "codex")] },
        scopeSpans: [
          {
            // A langwatch.* scope (NOT codex_cli_rs) so the ingestion
            // infra-span filter leaves these content spans alone.
            scope: { name: "langwatch.codex.rollout" },
            spans,
          },
        ],
      },
    ],
  };
}

/**
 * How many of a session's most recent completed turns the per-turn hook
 * re-sends. One would do for correctness; a few give a turn whose POST failed
 * a chance to land on the next turn without making the upload grow with the
 * session.
 */
const RECENT_TURN_WINDOW = 3;

/**
 * Walk codex's `YYYY/MM/DD` session tree, handing every rollout file to
 * `onFile`. The depth bound encodes that layout, so it lives here once rather
 * than in each caller, where a layout change would be fixed in one and missed
 * in the other.
 *
 * Newest first: the per-turn hook is looking for the session that just ended,
 * which is under today's date, and `readdir` order is whatever the filesystem
 * says. The path segments are zero-padded, so a descending name sort is a
 * descending date sort. A caller that stops on a match (`onFile` returning
 * true) therefore finds a recent session in the first directory it opens,
 * rather than after walking a long-lived account's older ones.
 */
async function walkRolloutFiles(
  root: string,
  onFile: (path: string, name: string) => Promise<boolean | void> | boolean,
): Promise<void> {
  async function walk(dir: string, depth: number): Promise<boolean> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    entries.sort((a, b) => b.name.localeCompare(a.name));
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < 3 && (await walk(full, depth + 1))) return true;
      } else if (e.isFile() && (await onFile(full, e.name))) {
        return true;
      }
    }
    return false;
  }
  await walk(root, 0);
}

/**
 * Where codex keeps its session transcripts. Honours `CODEX_HOME` the same way
 * codex itself does: with it set, codex writes transcripts under
 * `$CODEX_HOME/sessions`, and a harvest hard-coded to the home directory would
 * find the config but never the conversations it points at.
 */
export function defaultCodexSessionsRoot(): string {
  const codexHome = process.env.CODEX_HOME;
  return codexHome
    ? join(codexHome, "sessions")
    : join(homedir(), ".codex", "sessions");
}

/**
 * The rollout transcript for one codex session, or null when it is not on
 * disk. Codex names the file `rollout-<timestamp>-<threadId>.jsonl`, so the
 * thread id a completed turn reports pins the exact file with no time-window
 * guessing and no reading of unrelated sessions.
 */
export async function findRolloutForThread(
  threadId: string,
  sessionsRoot = defaultCodexSessionsRoot(),
): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(threadId)) return null;
  const suffix = `-${threadId}.jsonl`;
  let found: string | null = null;
  await walkRolloutFiles(sessionsRoot, (full, name) => {
    if (!name.endsWith(suffix)) return false;
    found = full;
    return true;
  });
  return found;
}

/**
 * Recover and emit the turns of ONE codex session, named by the thread id its
 * turn-completion payload reported. Returns the number of turns emitted.
 *
 * Only the last {@link RECENT_TURN_WINDOW} completed turns are posted, not the
 * whole transcript. The hook fires once per turn in a fresh process, so posting
 * everything each time would upload N(N+1)/2 spans over a session of N turns,
 * each carrying the whole accumulated history — quadratic in turns to record
 * work that is linear. The small window still gives a turn whose POST failed
 * a free retry on the next turn, which is the only reason to re-send at all.
 *
 * Receiver-side dedup is by span id, derived from the turn's trace id, so a
 * re-sent turn is dropped rather than duplicated. That dedup keeps the FIRST
 * version to arrive — a later re-post cannot correct it. Harmless here only
 * because a turn is never emitted until it has a reply, so what we send is
 * already final. Worth knowing before making the emitted content depend on
 * anything that keeps changing after the turn ends.
 */
export async function harvestCodexThread(args: {
  threadId: string;
  nowMs: number;
  endpoint: string;
  token: string;
  sessionsRoot?: string;
  fetchImpl?: typeof fetch;
}): Promise<number> {
  const root = args.sessionsRoot ?? defaultCodexSessionsRoot();
  const file = await findRolloutForThread(args.threadId, root);
  if (!file) return 0;
  let parsed: CodexTurnIO[];
  try {
    parsed = parseCodexRollout(await readFile(file, "utf8"));
  } catch {
    return 0;
  }
  const turns = parsed.slice(-RECENT_TURN_WINDOW);
  if (turns.length === 0) return 0;
  await postCodexTurns({
    turns,
    nowMs: args.nowMs,
    endpoint: args.endpoint,
    token: args.token,
    fetchImpl: args.fetchImpl,
  });
  return turns.length;
}

/**
 * Find rollout files codex wrote at or after `sinceMs`. Codex lays them out as
 * ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<sessionid>.jsonl; we walk the
 * date subdirs and keep files whose mtime is within the session window.
 */
export async function findRecentRollouts(
  sinceMs: number,
  sessionsRoot = defaultCodexSessionsRoot(),
): Promise<string[]> {
  const out: string[] = [];
  await walkRolloutFiles(sessionsRoot, async (full, name) => {
    if (!name.startsWith("rollout-") || !name.endsWith(".jsonl")) return false;
    try {
      const s = await stat(full);
      if (s.mtimeMs >= sinceMs) out.push(full);
    } catch {
      /* skip unreadable */
    }
    return false;
  });
  return out;
}

/** Read + parse every in-window rollout into one flat turn list. */
async function readRolloutTurns(
  sinceMs: number,
  sessionsRoot: string,
): Promise<CodexTurnIO[]> {
  const files = await findRecentRollouts(sinceMs, sessionsRoot);
  const turns: CodexTurnIO[] = [];
  for (const file of files) {
    try {
      turns.push(...parseCodexRollout(await readFile(file, "utf8")));
    } catch {
      /* skip unreadable rollout */
    }
  }
  return turns;
}

/**
 * A refusal from the ingest endpoint, named so the caller can act on it.
 *
 * The key codex posts with lives in its config file and is the normal thing to
 * go stale, so a refusal of the key reads as a key problem rather than as a
 * status code the reader has to look up.
 */
function ingestRefusal(status: number): GovernanceCliError {
  if (status === 401 || status === 403) {
    return new GovernanceCliError(
      status,
      "ingest_key_rejected",
      "LangWatch refused the ingest key codex is configured with. Run `langwatch ingest install codex` to issue a new one.",
    );
  }
  return new GovernanceCliError(
    status,
    "ingest_rejected",
    `LangWatch did not accept the conversation (HTTP ${status}).`,
  );
}

/**
 * POST a batch of turns as OTLP IO spans. Capped at 5s so a slow or unreachable
 * endpoint can't wedge the user's shell.
 *
 * A refused upload throws, the same as an unreachable one: a response that
 * arrived is not the same as content that landed, and the turn-completion path
 * runs after every turn of every session, so "the key expired" would otherwise
 * read as success forever. Each caller decides what to do with the throw: the
 * turn-completion path swallows it, the backfill reports it.
 */
async function postCodexTurns(args: {
  turns: CodexTurnIO[];
  nowMs: number;
  endpoint: string;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const { turns, nowMs, endpoint, token, fetchImpl } = args;
  const body = buildCodexIOExportRequest(turns, nowMs);
  const doFetch = fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  let response: Response;
  try {
    response = await doFetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw ingestRefusal(response.status);
}

/**
 * Recover codex turn I/O from rollouts written during this session and POST it
 * as OTLP spans. Returns the number of turns emitted (0 when nothing was
 * found), and rejects when the upload did not land, so a caller that reports a
 * count is only ever reporting content the server took.
 */
export async function harvestAndEmitCodexIO(args: {
  sinceMs: number;
  nowMs: number;
  endpoint: string;
  token: string;
  sessionsRoot?: string;
  fetchImpl?: typeof fetch;
}): Promise<number> {
  const { sinceMs, nowMs, endpoint, token, sessionsRoot, fetchImpl } = args;
  const turns = await readRolloutTurns(
    sinceMs,
    sessionsRoot ?? defaultCodexSessionsRoot(),
  );
  if (turns.length === 0) return 0;
  await postCodexTurns({ turns, nowMs, endpoint, token, fetchImpl });
  return turns.length;
}

/**
 * Streaming harvester: emits each turn the moment it completes instead of
 * dumping the whole session in one POST on exit. The wrapper polls `harvest()`
 * on an interval while codex runs (plus one final sweep on exit). The rollout
 * is append-only and `parseCodexRollout` only yields turns that have a reply,
 * so an in-flight turn simply isn't in the parse yet; we additionally dedup by
 * trace_id so a turn is POSTed exactly once across ticks. Re-emitting the same
 * turn would be idempotent server-side anyway (the span id is derived from the
 * trace_id), so a failed POST is safely retried on the next tick.
 */
export function createCodexIOStreamer(args: {
  sinceMs: number;
  endpoint: string;
  token: string;
  sessionsRoot?: string;
  fetchImpl?: typeof fetch;
}): { harvest: (nowMs: number) => Promise<number> } {
  const root = args.sessionsRoot ?? defaultCodexSessionsRoot();
  const emitted = new Set<string>();
  return {
    async harvest(nowMs: number): Promise<number> {
      const turns = await readRolloutTurns(args.sinceMs, root);
      const fresh = turns.filter((t) => t.traceId && !emitted.has(t.traceId));
      if (fresh.length === 0) return 0;
      await postCodexTurns({
        turns: fresh,
        nowMs,
        endpoint: args.endpoint,
        token: args.token,
        fetchImpl: args.fetchImpl,
      });
      // Mark emitted only after a successful POST so a transient failure
      // retries the same turns next tick (dedup keeps the retry idempotent).
      for (const t of fresh) emitted.add(t.traceId);
      return fresh.length;
    },
  };
}
