/**
 * Emit codex turn input/output as OTLP spans on codex's own per-turn
 * trace_ids, so they join the native token-spans with no receiver change.
 * See codex-rollout.ts for why the transcript is the only content source.
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
import { type CodexRolloutMeta, type CodexTurnIO, parseCodexRollout } from "./codex-rollout";
import { codexSessionIndexPath, readCodexThreadNames } from "./codex-session-index";
import { defaultStateDir, readFingerprint, stateFilePath, writeFingerprint } from "./hook-state";
import {
  buildSessionContextLogPayload,
  normalizeSessionName,
  parseGitRemoteUrl,
  type SessionContext,
  sessionContextFingerprint,
  sessionTitleFromPrompt,
} from "./session-context";
import { drainSessionContextSpool } from "./session-context-spool";

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
 * One span per turn, using codex's real trace_id. `langwatch.input`/`langwatch.output`
 * carry the LangWatch `chat_messages` envelope, which the receiver canonicalises to
 * `gen_ai.input.messages` so the drawer renders it like a claude trace.
 */
export function buildCodexIOExportRequest(turns: CodexTurnIO[], nowMs: number): OtlpExportRequest {
  const spans = turns.map((turn) => {
    const startMs = turn.startedAtMs ?? nowMs;
    const endMs = Math.max(startMs, nowMs);
    const attributes = [
      attr("langwatch.span.type", "llm"),
      attr("langwatch.input", JSON.stringify({ type: "chat_messages", value: turn.inputMessages })),
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
 * re-sends. One would do for correctness; a few let a turn whose POST failed
 * land on the next turn, without the upload growing with the session.
 */
const RECENT_TURN_WINDOW = 3;

/**
 * Walk codex's `YYYY/MM/DD` session tree, handing every rollout file to `onFile`. Zero-padded
 * path segments make a descending name sort a descending date sort, so a caller that stops on
 * a match finds a recent session first, not after walking a long-lived account's older ones.
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
      } else if (e.isFile() && (await onFile(full, e.name))) return true;
    }
    return false;
  }
  await walk(root, 0);
}

/**
 * Honours `CODEX_HOME` the same way codex itself does: with it set, codex
 * writes transcripts under `$CODEX_HOME/sessions`, and a harvest hard-coded
 * to the home directory would find the config but never the conversations.
 */
export function defaultCodexSessionsRoot(): string {
  const codexHome = process.env.CODEX_HOME;
  return codexHome ? join(codexHome, "sessions") : join(homedir(), ".codex", "sessions");
}

/**
 * Codex names the file `rollout-<timestamp>-<threadId>.jsonl`, so the thread
 * id a completed turn reports pins the exact file with no time-window
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
 * Send the declarations a sandboxed `langwatch ingest context` could not: the notify program
 * codex runs is spawned outside that sandbox, so it can reach the collector when the agent's
 * own shell cannot. Runs after the session-context post so a declared checkout becomes current.
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

/**
 * Only the last {@link RECENT_TURN_WINDOW} turns are posted, giving a failed
 * POST one retry without quadratic growth. Dedup is by span id, keeping the
 * first arrival — safe only because a turn is emitted once, after it's final.
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
    if (!name.startsWith("rollout-")) return false;
    if (!name.endsWith(".jsonl")) return false;
    try {
      const s = await stat(full);
      if (s.mtimeMs >= sinceMs) out.push(full);
    } catch {
      /* skip unreadable */
      void 0;
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
      void 0;
    }
  }
  return { turns, metas };
}

/**
 * The key codex posts with lives in its config file and is the normal thing
 * to go stale, so a refusal reads as a key problem, not a status code the
 * reader has to look up.
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
 * Capped at 5s so a slow/unreachable endpoint can't wedge the shell. A
 * refused upload throws like an unreachable one — an arrived response
 * isn't landed content, so "the key expired" never reads as success.
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
 * Live (`runGit`) is tried first: codex's `session_meta` is set once at
 * session start and never revised, so switching branches still reports the
 * first one. The rollout's version is the fallback for a transcript from elsewhere.
 */
function codexSessionContext({
  meta,
  runGit,
}: {
  meta: CodexRolloutMeta;
  runGit: GitRunner;
}): SessionContext | null {
  const live = meta.cwd ? readSessionContext({ directory: meta.cwd, runGit }) : null;
  if (live) return live;
  const repository = meta.gitRepositoryUrl ? parseGitRemoteUrl(meta.gitRepositoryUrl) : null;
  if (!repository) return null;
  return {
    repository,
    ...(meta.gitBranch ? { branch: meta.gitBranch } : {}),
  };
}

/**
 * Built from the rollout's own `session_meta` (codex needs no hooks.json
 * entry), deduped through the hooks' fingerprint state so a session posts
 * once. Best-effort: a missing identity or refused POST just returns false.
 */
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
  const { meta, nowMs, logsEndpoint, token, threadName, stateDir, fetchImpl, runGit } = args;
  if (!logsEndpoint) return false;
  if (!meta?.sessionId) return false;
  const title = meta.firstUserMessage ? sessionTitleFromPrompt(meta.firstUserMessage) : null;
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
    void 0;
  }
  return true;
}

/** How many context posts are in flight at once. */
const CONTEXT_POST_CONCURRENCY = 6;
/** How long the whole batch of context posts may hold the turn spans back. */
const CONTEXT_POST_BUDGET_MS = 15_000;

/**
 * The context's title is first-write and must reach the server before the
 * spans create the session row. Posts run concurrently under a shared time
 * budget — a serial await would cost the full 5s timeout per session.
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
      Array.from({ length: Math.min(CONTEXT_POST_CONCURRENCY, metas.length) }, async () => {
        while (!outOfBudget && next < metas.length) {
          // Read and advance in one synchronous step, so two workers never
          // take the same session.
          const meta = metas[next++] ?? null;
          // `postCodexSessionContext` reports failure rather than throwing,
          // and this guard keeps that true for the caller if it ever stops.
          await postCodexSessionContext({
            meta,
            threadName: meta?.sessionId ? threadNames?.get(meta.sessionId) : null,
            ...post,
          }).catch(() => false);
        }
      }),
    );
  } finally {
    clearTimeout(budget);
  }
}

/**
 * Recover codex turn I/O from rollouts written during this session and POST
 * it. Returns the number emitted (0 when nothing found), and rejects when
 * the upload didn't land, so a caller reporting a count only reports content the server took.
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
 * Streaming harvester: emits each turn as it completes, polled via
 * `harvest()` on an interval. Dedup is by trace_id, but re-emitting would be
 * idempotent server-side anyway, so a failed POST is safely retried next tick.
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
