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
import { LANGWATCH_SDK_VERSION } from "@/internal/constants";
import { GovernanceCliError } from "./cli-api";
import {
  type CodexRolloutMeta,
  type CodexTurnIO,
  parseCodexRollout,
} from "./codex-rollout";
import {
  defaultStateDir,
  readFingerprint,
  stateFilePath,
  writeFingerprint,
} from "./hook-state";
import {
  buildSessionContextLogPayload,
  parseGitRemoteUrl,
  type SessionContext,
  sessionContextFingerprint,
  sessionTitleFromPrompt,
} from "./session-context";

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
  logsEndpoint: string | null;
  token: string;
  sessionsRoot?: string;
  stateDir?: string;
  fetchImpl?: typeof fetch;
}): Promise<number> {
  const root = args.sessionsRoot ?? defaultCodexSessionsRoot();
  const file = await findRolloutForThread(args.threadId, root);
  if (!file) return 0;
  let turns: CodexTurnIO[];
  let meta: CodexRolloutMeta | null;
  try {
    ({ turns, meta } = parseCodexRollout(await readFile(file, "utf8")));
  } catch {
    return 0;
  }
  await postCodexSessionContext({
    meta,
    nowMs: args.nowMs,
    logsEndpoint: args.logsEndpoint,
    token: args.token,
    stateDir: args.stateDir,
    fetchImpl: args.fetchImpl,
  });
  const recent = turns.slice(-RECENT_TURN_WINDOW);
  if (recent.length === 0) return 0;
  await postCodexTurns({
    turns: recent,
    nowMs: args.nowMs,
    endpoint: args.endpoint,
    token: args.token,
    fetchImpl: args.fetchImpl,
  });
  return recent.length;
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

/** Read + parse every in-window rollout: one flat turn list, one meta per session. */
async function readRollouts({
  sinceMs,
  sessionsRoot,
}: {
  sinceMs: number;
  sessionsRoot: string;
}): Promise<{ turns: CodexTurnIO[]; metas: CodexRolloutMeta[] }> {
  const files = await findRecentRollouts(sinceMs, sessionsRoot);
  const turns: CodexTurnIO[] = [];
  const metas: CodexRolloutMeta[] = [];
  for (const file of files) {
    try {
      const parsed = parseCodexRollout(await readFile(file, "utf8"));
      turns.push(...parsed.turns);
      if (parsed.meta) metas.push(parsed.meta);
    } catch {
      /* skip unreadable rollout */
    }
  }
  return { turns, metas };
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
 * POST the session's repository identity as one `langwatch.session_context`
 * log record, the same record the command hooks send for claude, built here
 * from the rollout's `session_meta` line instead of a hook payload: codex
 * needs no hooks.json entry (and no per-hook trust grant) for its sessions to
 * say which repository and branch they worked on, because the rollout already
 * records both and the harvest is already trusted to run.
 *
 * Deduped through the same fingerprint state the hooks use, so a device
 * carrying both seams posts the context once per session, and a notify that
 * fires after every turn re-posts nothing while the context is unchanged.
 * Best-effort by construction: a session without git identity, a remote URL
 * the grammar cannot read, or a refused POST emits nothing and reports false,
 * because the content spans riding beside this are worth posting either way.
 */
export async function postCodexSessionContext(args: {
  meta: CodexRolloutMeta | null;
  nowMs: number;
  logsEndpoint: string | null;
  token: string;
  stateDir?: string;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const { meta, nowMs, logsEndpoint, token, stateDir, fetchImpl } = args;
  if (!logsEndpoint) return false;
  if (!meta?.sessionId || !meta.gitRepositoryUrl) return false;
  const repository = parseGitRemoteUrl(meta.gitRepositoryUrl);
  if (!repository) return false;
  const context: SessionContext = {
    repository,
    ...(meta.gitBranch ? { branch: meta.gitBranch } : {}),
  };
  const fingerprint = sessionContextFingerprint(context);
  const stateFile = stateFilePath({
    stateDir: stateDir ?? defaultStateDir(),
    agent: "codex",
    sessionId: meta.sessionId,
  });
  if (readFingerprint(stateFile) === fingerprint) return false;
  const payload = buildSessionContextLogPayload({
    sessionId: meta.sessionId,
    agent: "codex",
    context,
    timeUnixNano: `${nowMs}000000`,
    scopeVersion: LANGWATCH_SDK_VERSION,
    // Codex generates no session title and withholds prompt text from its
    // own events, so the transcript's first typed prompt names the session.
    title: meta.firstUserMessage
      ? sessionTitleFromPrompt(meta.firstUserMessage)
      : null,
  });
  const doFetch = fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  let response: Response;
  try {
    response = await doFetch(logsEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) return false;
  // Written only after the server took it, so a failed POST retries on the
  // next turn instead of assuming the context landed. A state-dir that cannot
  // be written costs a re-POST next turn and nothing else, so it must not
  // reject: the caller awaits this before it posts the turn spans, and losing
  // the conversation over a bookkeeping write would be the worse trade.
  try {
    writeFingerprint({ stateFile, fingerprint, now: () => nowMs });
  } catch {
    // Deliberately swallowed; the context record already landed.
  }
  return true;
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
  logsEndpoint: string | null;
  token: string;
  sessionsRoot?: string;
  stateDir?: string;
  fetchImpl?: typeof fetch;
}): Promise<number> {
  const {
    sinceMs,
    nowMs,
    endpoint,
    logsEndpoint,
    token,
    sessionsRoot,
    stateDir,
    fetchImpl,
  } = args;
  const { turns, metas } = await readRollouts({
    sinceMs,
    sessionsRoot: sessionsRoot ?? defaultCodexSessionsRoot(),
  });
  for (const meta of metas) {
    await postCodexSessionContext({
      meta,
      nowMs,
      logsEndpoint,
      token,
      stateDir,
      fetchImpl,
    });
  }
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
  logsEndpoint: string | null;
  token: string;
  sessionsRoot?: string;
  stateDir?: string;
  fetchImpl?: typeof fetch;
}): { harvest: (nowMs: number) => Promise<number> } {
  const root = args.sessionsRoot ?? defaultCodexSessionsRoot();
  const emitted = new Set<string>();
  return {
    async harvest(nowMs: number): Promise<number> {
      const { turns, metas } = await readRollouts({
        sinceMs: args.sinceMs,
        sessionsRoot: root,
      });
      // The fingerprint state dedups across ticks (and across the notify
      // seam), so re-offering every in-window session each tick posts once.
      for (const meta of metas) {
        await postCodexSessionContext({
          meta,
          nowMs,
          logsEndpoint: args.logsEndpoint,
          token: args.token,
          stateDir: args.stateDir,
          fetchImpl: args.fetchImpl,
        });
      }
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
