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
import {
  type GitRunner,
  readSessionContext,
  runGitCommand,
} from "@/cli/commands/ingestion/git-context";
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
import { drainSessionContextSpool } from "./session-context-spool";
import {
  codexSessionIndexPath,
  readCodexThreadNames,
} from "./codex-session-index";
import {
  buildSessionContextLogPayload,
  normalizeSessionName,
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
/**
 * Send the declarations a sandboxed `langwatch ingest context` could not.
 *
 * The notify program codex runs is spawned from codex's own process, outside
 * the sandbox it puts its shell in, so this is the seam that can reach the
 * collector when the agent's own shell cannot. It runs after the session
 * context posts above, so a declared checkout is the last one written and
 * becomes the session's current branch.
 */
async function drainCodexSpool(args: {
  nowMs: number;
  logsEndpoint: string | null;
  token: string;
  stateDir?: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const { logsEndpoint, token } = args;
  if (!logsEndpoint) return;
  const doFetch = args.fetchImpl ?? fetch;
  await drainSessionContextSpool({
    stateDir: args.stateDir ?? defaultStateDir(),
    now: () => args.nowMs,
    post: async (payload) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      try {
        const response = await doFetch(logsEndpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        return response.ok;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

export async function harvestCodexThread(args: {
  threadId: string;
  nowMs: number;
  endpoint: string;
  logsEndpoint: string | null;
  token: string;
  sessionsRoot?: string;
  stateDir?: string;
  fetchImpl?: typeof fetch;
  runGit?: GitRunner;
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
  const threadNames = await readCodexThreadNames(codexSessionIndexPath(root));
  await postCodexSessionContext({
    meta,
    nowMs: args.nowMs,
    logsEndpoint: args.logsEndpoint,
    token: args.token,
    threadName: meta?.sessionId ? threadNames.get(meta.sessionId) : null,
    stateDir: args.stateDir,
    fetchImpl: args.fetchImpl,
    runGit: args.runGit,
  });
  await drainCodexSpool(args);
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
/**
 * Which repository and branch a codex session is working in.
 *
 * The rollout's own `session_meta` is the weaker of the two sources and is
 * consulted second. Codex fills it only when the session STARTED inside a
 * repository, and never revises it: a reviewer that checks out one pull
 * request's branch after another still reports the branch it opened with, and a
 * session started a directory above the checkout reports nothing for its whole
 * life, however much repository work it does. Codex has no equivalent of a
 * native worktree switch, so that first directory is the session for good.
 *
 * The harvest runs on the machine that ran the turn, moments after it, so the
 * working directory can be read directly and answers for the turn being
 * harvested rather than for the session's first minute. The rollout's values
 * stay as the fallback, which is what a transcript harvested on another machine
 * (or after the checkout is gone) still has.
 */
function codexSessionContext({
  meta,
  runGit,
}: {
  meta: CodexRolloutMeta;
  runGit: GitRunner;
}): SessionContext | null {
  const live = meta.cwd
    ? readSessionContext({ directory: meta.cwd, runGit })
    : null;
  if (live) return live;
  const repository = meta.gitRepositoryUrl
    ? parseGitRemoteUrl(meta.gitRepositoryUrl)
    : null;
  if (!repository) return null;
  return {
    repository,
    ...(meta.gitBranch ? { branch: meta.gitBranch } : {}),
  };
}

export async function postCodexSessionContext(args: {
  meta: CodexRolloutMeta | null;
  nowMs: number;
  logsEndpoint: string | null;
  token: string;
  /** The session's name from codex's own session index, when it has one. */
  threadName?: string | null;
  stateDir?: string;
  fetchImpl?: typeof fetch;
  runGit?: GitRunner;
}): Promise<boolean> {
  const {
    meta,
    nowMs,
    logsEndpoint,
    token,
    threadName,
    stateDir,
    fetchImpl,
    runGit,
  } = args;
  if (!logsEndpoint) return false;
  if (!meta?.sessionId) return false;
  const title = meta.firstUserMessage
    ? sessionTitleFromPrompt(meta.firstUserMessage)
    : null;
  const name = normalizeSessionName(threadName);
  const context = codexSessionContext({
    meta,
    runGit: runGit ?? runGitCommand,
  });
  // A codex session appears in the sessions screen only through this
  // record, so a session outside any repository still posts one as long
  // as there is a name to carry. With no identity and no name there is
  // nothing to say.
  if (!context && !title && !name) return false;
  const fingerprint = sessionContextFingerprint(context ?? {}, { title, name });
  const stateFile = stateFilePath({
    stateDir: stateDir ?? defaultStateDir(),
    agent: "codex",
    sessionId: meta.sessionId,
  });
  if (readFingerprint(stateFile) === fingerprint) return false;
  const payload = buildSessionContextLogPayload({
    sessionId: meta.sessionId,
    agent: "codex",
    context: context ?? {},
    timeUnixNano: `${nowMs}000000`,
    scopeVersion: LANGWATCH_SDK_VERSION,
    // Codex withholds prompt text from its own events, so the transcript's
    // first typed prompt titles the session — and codex's OWN name for the
    // thread, from its session index, outranks it whenever one exists.
    title,
    name,
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

/** How many context posts are in flight at once. */
const CONTEXT_POST_CONCURRENCY = 6;
/** How long the whole batch of context posts may hold the turn spans back. */
const CONTEXT_POST_BUDGET_MS = 15_000;

/**
 * POST every session's context record before the turn spans go out.
 *
 * The spans wait for these on purpose: the title on the context record is
 * first-write, so it has to reach the server before the spans create the
 * session row. That makes a slow logs endpoint a delay on the conversation
 * itself, and awaiting the posts one at a time turned it into a long one:
 * `--all` reads every rollout on disk, and against an endpoint that never
 * answers each of those sessions spent the full 5 s per-post timeout before
 * the next one started.
 *
 * So the posts run together, a few at a time, and the batch stops starting
 * new ones once the budget is gone. The worst case is the budget plus the one
 * post still in flight, whatever the session count. Sessions the batch does
 * not reach keep their state file empty and are offered again on the next
 * harvest, which is the same path a refused POST already takes.
 */
async function postCodexSessionContexts(args: {
  metas: CodexRolloutMeta[];
  nowMs: number;
  logsEndpoint: string | null;
  token: string;
  /** Codex's own name per session id, from its session index. */
  threadNames?: Map<string, string>;
  stateDir?: string;
  fetchImpl?: typeof fetch;
  runGit?: GitRunner;
}): Promise<void> {
  const { metas, threadNames, ...post } = args;
  if (metas.length === 0) return;
  let next = 0;
  let outOfBudget = false;
  const budget = setTimeout(() => {
    outOfBudget = true;
  }, CONTEXT_POST_BUDGET_MS);
  // A CLI must not stay alive for the budget alone: every post can finish
  // early, and then there is nothing left to wait for.
  budget.unref?.();
  try {
    await Promise.all(
      Array.from(
        { length: Math.min(CONTEXT_POST_CONCURRENCY, metas.length) },
        async () => {
          while (!outOfBudget && next < metas.length) {
            // Read and advance in one synchronous step, so two workers never
            // take the same session.
            const meta = metas[next++] ?? null;
            // `postCodexSessionContext` reports failure rather than throwing,
            // and this guard keeps that true for the caller if it ever stops.
            await postCodexSessionContext({
              meta,
              threadName: meta?.sessionId
                ? threadNames?.get(meta.sessionId)
                : null,
              ...post,
            }).catch(() => false);
          }
        },
      ),
    );
  } finally {
    clearTimeout(budget);
  }
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
  runGit?: GitRunner;
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
    runGit,
  } = args;
  const root = sessionsRoot ?? defaultCodexSessionsRoot();
  const { turns, metas } = await readRollouts({
    sinceMs,
    sessionsRoot: root,
  });
  await postCodexSessionContexts({
    metas,
    nowMs,
    logsEndpoint,
    token,
    threadNames: await readCodexThreadNames(codexSessionIndexPath(root)),
    stateDir,
    fetchImpl,
    runGit,
  });
  await drainCodexSpool(args);
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
  runGit?: GitRunner;
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
      // seam), so re-offering every in-window session each tick posts once —
      // and re-reading the index each tick is what lets a rename land on the
      // very next turn, as a changed fingerprint.
      await postCodexSessionContexts({
        metas,
        nowMs,
        logsEndpoint: args.logsEndpoint,
        token: args.token,
        threadNames: await readCodexThreadNames(codexSessionIndexPath(root)),
        stateDir: args.stateDir,
        fetchImpl: args.fetchImpl,
        runGit: args.runGit,
      });
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
