// AgentAdapter that drives Langy through the REAL product surface: the same
// `langy.createConversation` / `langy.continueConversation` tRPC mutations and
// `langy.onTurnStream` SSE subscription the browser panel uses (see
// src/features/langy/logic/langyChatTransport.ts). Authenticates once as the
// seeded local-dev admin and reuses the session cookie for every call.
//
// Wire format below (POST body `{"json": input}`, response
// `{"result":{"data":{"json": output}}}`, SSE frames `data: {"json": entry}`)
// was confirmed directly against a live haven stack before writing this file
// — see e2e/langy/README.md for how to point this at a different stack.

import type { AgentAdapter, AgentInput, AgentReturnTypes } from "@langwatch/scenario";
import { AgentRole } from "@langwatch/scenario";
import type { ModelMessage } from "ai";
import { APP_BASE, PROJECT_ID } from "./config";
import { getSessionCookie, trpcMutate } from "./trpc";

interface TurnPart {
  type: string;
  text?: string;
  [key: string]: unknown;
}
interface TurnMessage {
  role: "user" | "assistant" | "system";
  parts: TurnPart[];
}

/** One `ui` entry as the turn stream published it. */
export interface UiActionEntry {
  actionId: string;
  kind: string;
  payload: unknown;
}

/** A resource chip, as the composer attaches it to a turn. */
export interface PageContextChip {
  kind: string;
  ref?: string;
  label: string;
}

export interface LangySessionState {
  conversationId: string | null;
  /**
   * The turn this session is streaming, or the last one it streamed. The fake
   * workbench tab dedups the actions it sees on `turnId:actionId`, the same
   * identity the panel uses, so it needs the id the send returned.
   */
  currentTurnId: string | null;
  /** Every navigate instruction observed on this session's turn streams, in
   * order. Navigation scenarios assert on these: the href is the hard fact
   * that the agent-driven navigate actually landed on the stream. */
  navigateHrefs: string[];
  /** Every settled bash command observed on this session's turn streams, in
   * order. The github-gate scenario asserts on these: the command card that
   * tripped the gate must reach the stream before the gate cancels it. */
  toolCommands: string[];
}

let cachedCookie: Promise<string> | null = null;

/**
 * Sign in once (per test process) and cache the better-auth session cookie.
 * Clears the cache on rejection — otherwise a single transient sign-in
 * failure (a momentary network blip, the app mid-restart) would permanently
 * poison every remaining test in the run, since `??=` only checks for
 * null/undefined at assignment time and a rejected promise is neither.
 */
function getSessionCookie(): Promise<string> {
  cachedCookie ??= (async () => {
    try {
      let res: Response;
      for (let attempt = 1; ; attempt++) {
        res = await fetch(`${APP_BASE}/api/auth/sign-in/email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: APP_BASE },
          body: JSON.stringify({
            email: ADMIN_EMAIL,
            password: ADMIN_PASSWORD,
          }),
          signal: AbortSignal.timeout(15_000),
        });
        // Every vitest run signs in once, so a burst of runs (a suite driven
        // in chunks) can land on the auth rate limiter. That is the runner
        // being throttled, not a scenario failing: wait out the window.
        if (res.status !== 429 || attempt >= 6) break;
        console.log(`[scenario] sign-in rate-limited (429), waiting 20s (attempt ${attempt})`);
        await new Promise((resolve) => setTimeout(resolve, 20_000));
      }
      if (!res.ok) {
        throw new Error(`Langy test sign-in failed: ${res.status} ${await res.text()}`);
      }
      const setCookie = res.headers.get("set-cookie") ?? "";
      // better-auth only applies the __Secure- prefix on HTTPS origins, so a
      // plain-http local stack sets the bare cookie name. Accept both.
      const match = /(?:__Secure-)?better-auth\.session_token=[^;]+/.exec(setCookie);
      if (!match) {
        throw new Error("Langy test sign-in: no better-auth session cookie in response");
      }
      return match[0];
    } catch (error) {
      cachedCookie = null;
      throw error;
    }
  })();
  return cachedCookie;
}

/** Mirror langyChatTransport.ts's message shape: {role, parts: [{type, text}]}. */
function toTurnMessage(msg: { role: string; content: unknown }): TurnMessage {
  const role: TurnMessage["role"] =
    msg.role === "assistant" || msg.role === "system" ? msg.role : "user";
  if (typeof msg.content === "string") {
    return { role, parts: [{ type: "text", text: msg.content }] };
  }
  if (Array.isArray(msg.content)) {
    return {
      role,
      parts: msg.content
        .filter((p: any) => p?.type === "text" && typeof p.text === "string")
        .map((p: any) => ({ type: "text", text: p.text })),
    };
  }
  return { role, parts: [] };
}

async function trpcMutate<T>({
  cookie,
  path,
  input,
}: {
  cookie: string;
  path: string;
  input: unknown;
}): Promise<T> {
  const res = await fetch(`${APP_BASE}/api/trpc/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: APP_BASE,
    },
    body: JSON.stringify({ json: input }),
    // Generous on purpose: under a queue backlog the turn mutation has been
    // measured completing server-side at 135s, and a full failure-analysis
    // turn on the opencode harness has been measured working past 180s.
    // Aborting a still-working turn destroys the run (the judge grades a
    // one-token reply), and retrying is worse — the retry races the accepted
    // first attempt into langy_turn_in_progress.
    signal: AbortSignal.timeout(300_000),
  });
  const body: any = await res.json().catch(() => null);
  if (!res.ok || !body || body.error) {
    // The tRPC error envelope nests the domain code at data.error.code (see
    // the langy_turn_in_progress payload: {"json":{"data":{"error":{"code":
    // "langy_turn_in_progress"}}}}). The old data.domainError.code path never
    // matched anything, which silently disabled the turn-lock retry below.
    const domainErrorCode =
      body?.error?.json?.data?.error?.code ?? body?.error?.json?.data?.domainError?.code;
    const err = new Error(
      `Langy ${path} -> ${res.status}: ${JSON.stringify(body?.error ?? body)}`,
    ) as Error & { domainErrorCode?: string };
    err.domainErrorCode = domainErrorCode;
    throw err;
  }
  return body.result.data.json as T;
}

/**
 * `langy_turn_in_progress` fires from two different checks in
 * langy-turn.service.ts: the authoritative Postgres admission claim
 * (`admission.kind === "busy"`), and a conversation-status PROJECTION read
 * that its own comment calls "only a rollout/back-compat hint... the
 * Postgres admission claim above is the concurrency authority" — i.e. it can
 * go stale.
 *
 * Two confirmed causes, both server-side and neither fixable by retrying
 * around them forever:
 *  1. A permanently-abandoned COMMITTED admission row (worker died without
 *     ever publishing a terminal event) — fixed server-side via
 *     COMMITTED_ABANDON_MS in langy-turn-admission.prisma.repository.ts (a
 *     10-minute reclaim backstop); no client-side retry budget should be
 *     sized to paper over that case, it's now a real self-heal on the server.
 *  2. A worker crashing mid-reply (`langy_worker_stopped`) — confirmed live
 *     via the DB: the projection correctly resolves to `status: "failed"`
 *     with that error, and the admission row is correctly released, but
 *     agent-turn-liveness.subscriber.ts's own stall detection can take up to
 *     MAX_STALL_MS (90s) to notice and fail the turn. A 15s retry budget
 *     (the old 3×5s) gives up on the server's OWN documented recovery window
 *     before it has even elapsed, turning a self-healing 90s hiccup into a
 *     hard test failure. Retry comfortably past that window instead.
 */
async function trpcMutateWithTurnLockRetry<T>({
  cookie,
  path,
  input,
}: {
  cookie: string;
  path: string;
  input: unknown;
}): Promise<T> {
  const maxAttempts = 8;
  const delayMs = 15_000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await trpcMutate<T>({ cookie, path, input });
    } catch (error) {
      const code = (error as { domainErrorCode?: string }).domainErrorCode;
      if (code !== "langy_turn_in_progress" || attempt === maxAttempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("unreachable");
}

/**
 * The turn failed for a reason that says nothing about how Langy behaves: the
 * worker died mid-reply, or the stream closed without the turn ever settling.
 * The scenario logger retries one of these once instead of grading it.
 *
 * A property rather than a message match. The two markers used to be found by
 * substring on `String(error)`, which reads a code out of prose and breaks the
 * moment the wording moves.
 *
 * Walks the cause chain: the scenario library rethrows adapter errors as
 * `new Error(..., { cause: error })`, so the marker arrives one level down.
 */
export function isTransientInfrastructureError(error: unknown): boolean {
  let current: unknown = error;
  for (let hops = 0; current && hops < 8; hops++) {
    if ((current as { transientInfrastructure?: boolean }).transientInfrastructure === true) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function transientInfrastructureError(message: string): Error {
  const error = new Error(message) as Error & {
    transientInfrastructure?: boolean;
  };
  error.transientInfrastructure = true;
  return error;
}

/**
 * The stream's error entry carries the handled-error JSON as a string in
 * `error` (and human text in `errorText`). Returns its code and tips when it
 * parses as one, null for anything else.
 *
 * The app parses the same shape in `readLangyStreamError`, and this stays a
 * separate reader on purpose: the suite drives a live stack over HTTP and
 * imports nothing from `src/`, so it cannot drift with a refactor it never
 * compiled against. What it must not do is trust the shape, since `tips[0]`
 * goes into the text a judge grades — every field is checked here.
 */
function parseHandledStreamError(entry: {
  error?: unknown;
}): { code: string; tips: string[] } | null {
  if (typeof entry.error !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(entry.error);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { code, tips } = parsed as { code?: unknown; tips?: unknown };
  if (typeof code !== "string") return null;
  return {
    code,
    tips: Array.isArray(tips) ? tips.filter((tip): tip is string => typeof tip === "string") : [],
  };
}

/**
 * The judge grades from these frames while the AGENT read the full payload,
 * so any cut between the two must be stated or the judge reads a missing item
 * as a nonexistent one and fails a genuinely grounded reply as fabrication
 * (it did, twice: real seeded trace ids cited from an elided array tail, and
 * a result count that sat past this adapter's own byte cap). Two cuts exist:
 * the manager's structural reduction for the panel (toolmap.TruncateToolOutput
 * elides array tails behind an "… N more items truncated" marker), and the
 * byte cap this adapter applies when building the judge's tool message. The
 * note states that a cut happened; it adds no evidence.
 */
function boundOutputForJudge(output: string): string {
  const capped = output.slice(0, 8192);
  const cut = output.length > capped.length || capped.includes("more items truncated");
  if (!cut) return capped;
  return `${capped}\n\n[Display note: this tool output was reduced for display. The agent read the full payload, so data beyond what is shown here existed. A reply citing an item or a count that is not visible here is citing the reduced part, not fabricating.]`;
}

/** One settled tool call observed on the turn stream, as the panel showed it. */
export interface SettledToolCall {
  id: string;
  name: string;
  input: unknown;
  output: string;
  isError: boolean;
}

/** How long the harness listens to one turn's stream. */
const TURN_STREAM_TIMEOUT_MS = 420_000;

/** A turn's reply, and how the turn arrived at it. */
interface TurnText {
  /** The reply, chosen the way the product chooses it (see the fold below). */
  text: string;
  /**
   * Whether `text` is the passage the turn ENDED on.
   *
   * False when the turn ran tools and then went quiet: there `text` is the
   * whole narration, which `onNarration` has already reported passage by
   * passage, so a caller that recorded those must not record it twice. This is
   * the same distinction `orderedParts` draws server-side when it assembles the
   * durable parts (`langy-final-parts.ts`).
   */
  hasEndedOnText: boolean;
}

/** Reads the onTurnStream SSE frames until the server closes the response. */
async function streamTurnText({
  cookie,
  params,
  onNavigate,
  onNarration,
  onSettledTool,
  onUiAction,
}: {
  cookie: string;
  params: { projectId: string; conversationId: string; turnId: string };
  /** Called for each navigate entry on the stream (live-only, never durable). */
  onNavigate?: (href: string) => void;
  /**
   * Called for each passage Langy writes BETWEEN its tool calls, in order,
   * as the following call starts.
   *
   * The passage the turn ends on is not reported here: it is the reply, and it
   * comes back as `text`.
   */
  onNarration?: (text: string) => void;
  /** Called for each settled tool card on the stream, in order. */
  onSettledTool?: (call: SettledToolCall) => void;
  /**
   * Called for each dispatched UI action on the stream, in order.
   *
   * This is the whole browser leg's entry point: the entry arrives with no
   * extra network hop, which is what buys a listener the 3 second claim
   * window. Fired synchronously from the frame reader, so a listener must
   * start its work and return rather than blocking the read loop.
   */
  onUiAction?: (entry: UiActionEntry) => void;
}): Promise<TurnText> {
  const input = encodeURIComponent(JSON.stringify({ json: params }));
  const res = await fetch(`${APP_BASE}/api/sse/langy.onTurnStream?input=${input}`, {
    headers: { Cookie: cookie, Accept: "text/event-stream" },
    signal: AbortSignal.timeout(240_000),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Langy onTurnStream -> ${res.status}: ${await res.text()}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let assistantText = "";
  // Mirror turnfold.go's text selection: the product's final reply keeps only
  // the text emitted AFTER the last tool frame (pre-tool deltas are status
  // narration, dropped server-side). Track the same trailing segment here so
  // the judge grades the reply the user actually receives, not the raw stream.
  let textAfterLastTool = "";
  let sawTool = false;
  let toolSeq = 0;
  let streamError: string | null = null;
  let streamErrorCode: string | null = null;
  let sawTerminal = false;

  const handleFrame = (rawFrame: string) => {
    for (const line of rawFrame.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;
      let entry: any;
      try {
        entry = JSON.parse(payload).json;
      } catch {
        continue;
      }
      if (!entry || typeof entry !== "object") continue;
      if (entry.type === "delta" && typeof entry.text === "string") {
        assistantText += entry.text;
        textAfterLastTool += entry.text;
      } else if (entry.type === "tool") {
        // The passage that was running when this call started belongs in front
        // of it. Reported here rather than at the end of the stream because
        // this frame is what fixes its place in the order.
        if (textAfterLastTool.trim() !== "") onNarration?.(textAfterLastTool);
        textAfterLastTool = "";
        sawTool = true;
        if (entry.phase === "end") {
          toolSeq += 1;
          onSettledTool?.({
            id: typeof entry.id === "string" && entry.id ? entry.id : `tool-${toolSeq}`,
            name: typeof entry.name === "string" ? entry.name : "tool",
            input: entry.input ?? {},
            output: typeof entry.output === "string" ? entry.output : "",
            isError: entry.isError === true,
          });
        }
      } else if (entry.type === "error") {
        // The server emits errorText (see langyChatTransport.ts's onEntry
        // "error" case), not message — checking the wrong field silently
        // swallowed every real error message behind a generic placeholder.
        //
        // One handled code is a conversation outcome, not a failure:
        // langy_github_not_connected stops the turn and the panel renders an
        // Install prompt from the error's tips. Grade that visible outcome
        // instead of erroring the scenario — locally no GitHub App exists, so
        // this is the product's expected answer to any PR request.
        const parsed = parseHandledStreamError(entry);
        if (parsed?.code === "langy_github_not_connected") {
          // The gate stops the turn after the tripping command card (already
          // captured above as a tool result); the panel then renders the
          // install prompt as a product card from the error's tips. Mirror
          // that shape: a langy-card block is the rubric's marker for the
          // product's own UI, not Langy's prose.
          const installCard = `\`\`\`langy-card\n${
            parsed.tips[0] ?? "The LangWatch GitHub App is not installed for this project."
          }\n\`\`\``;
          // Both buffers: the fold below returns textAfterLastTool whenever a
          // tool ran and that buffer is non-empty, so a card appended to
          // assistantText alone is dropped whenever any delta arrived after
          // the last tool frame.
          assistantText += installCard;
          textAfterLastTool += installCard;
        } else {
          streamError =
            typeof entry.errorText === "string"
              ? entry.errorText
              : `Langy stream error (raw: ${JSON.stringify(entry)})`;
          streamErrorCode = parsed?.code ?? null;
        }
      }
      if (entry.type === "navigate" && typeof entry.href === "string") {
        onNavigate?.(entry.href);
      }
      if (
        entry.type === "ui" &&
        typeof entry.actionId === "string" &&
        typeof entry.kind === "string"
      ) {
        onUiAction?.({
          actionId: entry.actionId,
          kind: entry.kind,
          payload: entry.payload,
        });
      }
      if (entry.type === "end") sawTerminal = true;
      // "complete" (SSE stream finished) / "connected" / "status" carry no
      // assistant text — nothing further to accumulate.
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      handleFrame(frame);
    }
  }
  buf += decoder.decode();
  if (buf.trim()) handleFrame(buf);

  if (streamError) {
    const message = `Langy turn error: ${streamError}`;
    // A worker that died mid-reply says nothing about how Langy answers, so it
    // is retried rather than graded. Any other handled code is a real outcome.
    throw streamErrorCode === "langy_worker_stopped"
      ? transientInfrastructureError(message)
      : new Error(message);
  }
  // Same fold as turnfold.go: when tools ran and real text followed the last
  // tool, the product shows only that trailing text (the cards carry the rest),
  // so the judge must grade what the user actually reads. The cards themselves
  // ride as tool messages (see makeLangyAdapter), never inside this text.
  if (sawTool && textAfterLastTool.trim() !== "") {
    return {
      text: textAfterLastTool.replace(/^[\s]+/, ""),
      hasEndedOnText: true,
    };
  }
  // Whitespace is truthy, so a turn whose only deltas were blank lines would
  // otherwise be handed to the judge as a reply the user cannot see.
  if (assistantText.trim()) return { text: assistantText, hasEndedOnText: !sawTool };

  // No text. WHICH no-text this is decides whether a judge should ever see it,
  // and the two used to be indistinguishable behind a literal "(no response)"
  // that the judge then graded as a terrible reply.
  //
  // Terminal marker present: the turn really did finish silently. That is a
  // product regression now, because the token buffer emits a fallback line for
  // any turn that reaches its terminal marker (LANGY_EMPTY_TURN_FALLBACK).
  //
  // No terminal marker: the stream closed without the turn ever settling — the
  // harness never observed a turn, typically because the conversation lock was
  // still held (the adapter's own retry budget is ~120s) or the machine was
  // loaded. That is infrastructure, not agent behaviour, so it fails loudly
  // here rather than being scored as a bad answer.
  if (sawTerminal) {
    throw new Error(
      "Langy turn ended with a terminal marker but no visible text — the empty-turn fallback did not fire",
    );
  }
  throw transientInfrastructureError(
    "Langy turn produced no text and never settled — the stream closed with no terminal marker (conversation lock still held, or the stack is too loaded to answer); this is an environment failure, not a reply to grade",
  );
}

/** One thing a turn did, in the order it did it. */
type TurnSegment = { kind: "text"; narration: string } | { kind: "tool"; call: SettledToolCall };

/**
 * The turn as the scenario framework receives it: what Langy wrote and what it
 * ran, interleaved the way it happened.
 *
 * The product's tool cards ride as real tool traffic, so the judge sees a
 * native tool-call/tool-result exchange (the retrieval that grounds the reply's
 * claims) and the user simulator sees the framework's compact summaries of it.
 *
 * The passages Langy writes between those calls ride WITH them, in the same
 * assistant message as the calls they introduce. They have to: a turn folds
 * down to the passage it ended on (`turnfold.Result`), so a transcript built
 * from that alone drops every line written before a call, and a rubric that
 * grades the loop's narration then reads a turn that narrated well as silent.
 * Keeping them beside their calls, rather than as replies of their own, also
 * keeps them plainly part of the turn's WORK: the single trailing message with
 * string content is the reply, exactly as it was, and no criterion that grades
 * the reply starts grading a status line instead.
 */
function turnMessages({
  segments,
  text,
  hasEndedOnText,
}: {
  segments: TurnSegment[];
  text: string;
  hasEndedOnText: boolean;
}): ModelMessage[] {
  const messages: ModelMessage[] = [];
  let narration: string[] = [];
  let batch: SettledToolCall[] = [];

  const flush = () => {
    if (batch.length === 0 && narration.length === 0) return;
    messages.push({
      role: "assistant",
      content: [
        ...narration.map((part) => ({ type: "text" as const, text: part })),
        ...batch.map((call) => ({
          type: "tool-call" as const,
          toolCallId: call.id,
          toolName: call.name,
          input: call.input,
        })),
      ],
    });
    if (batch.length > 0) {
      messages.push({
        role: "tool",
        content: batch.map((call) => ({
          type: "tool-result" as const,
          toolCallId: call.id,
          toolName: call.name,
          // The server already bounds tool output (8KB canonical reduction);
          // mirror that bound rather than cutting deeper, and state the cut
          // when one happens: a silent slice has cost a judge the very count a
          // reply was grounded on.
          output: {
            type: call.isError ? ("error-text" as const) : ("text" as const),
            value: boundOutputForJudge(call.output),
          },
        })),
      });
    }
    narration = [];
    batch = [];
  };

  for (const segment of segments) {
    if (segment.kind === "tool") {
      batch.push(segment.call);
      continue;
    }
    // A passage after a call opens the next stretch of work, so the calls
    // already gathered close here and keep their place in front of it.
    if (batch.length > 0) flush();
    narration.push(segment.narration);
  }
  flush();

  // A turn that ran tools and then went quiet has no reply of its own: `text`
  // is the narration already recorded above, and appending it would say every
  // passage twice.
  if (hasEndedOnText || messages.length === 0) {
    messages.push({ role: "assistant", content: text });
  }
  return messages;
}

/** The adapter, plus the handles the suites and the fake tab read it through. */
export type LangyAdapter = AgentAdapter & {
  state: LangySessionState;
  /**
   * Where a fake workbench tab attaches itself.
   *
   * Mutable rather than a constructor argument, because a tab opens and closes
   * around the conversation rather than around the adapter: the live suite
   * closes its tab between two turns and the same adapter carries on with the
   * backend leg.
   */
  onUiAction?: (entry: UiActionEntry) => void;
  /**
   * Forget the conversation, so the next turn opens a new one.
   *
   * A replayed scenario has to start a NEW conversation. Carrying the old id
   * over means the replay's first message arrives as `continueConversation` on
   * a conversation whose turn is often still running, so the server answers
   * `conversation_busy`, the replay burns its budget on 409s, and whatever it
   * does record is grafted onto the transcript of the attempt that failed.
   * `runScenarioAndLog` calls this on every agent that has it before it
   * replays.
   */
  resetSession: () => void;
};

export function makeLangyAdapter(
  options: {
    /**
     * The resource chips a real composer would carry.
     *
     * A turn with an `experiment` chip is what tells the agent the page it is
     * looking at accepts live UI actions, so a suite that opens a fake tab
     * sends one and a suite that does not leaves this out.
     */
    pageContext?: PageContextChip[];
  } = {},
): LangyAdapter {
  const state: LangySessionState = {
    conversationId: null,
    currentTurnId: null,
    navigateHrefs: [],
    toolCommands: [],
    toolOutputs: [],
  };
  const adapter: AgentAdapter = {
    role: AgentRole.AGENT,
    call: async (input: AgentInput): Promise<AgentReturnTypes> => {
      const cookie = await getSessionCookie();
      // Tool traffic from earlier turns stays out of the product payload: the
      // panel transport sends only the text history, and a role:"tool" message
      // would otherwise reach the API as an empty user message.
      const messages = input.messages
        .filter((m: any) => m.role !== "tool")
        .map((m: any) => toTurnMessage(m))
        .filter((m) => m.parts.length > 0 || m.role === "user");
      const turnInput = {
        requestId: crypto.randomUUID(),
        messages,
        projectId: PROJECT_ID,
        ...(options.pageContext ? { pageContext: options.pageContext } : {}),
      };
      const { path, body } = state.conversationId
        ? {
            path: "langy.continueConversation",
            body: { ...turnInput, conversationId: state.conversationId },
          }
        : { path: "langy.createConversation", body: turnInput };

      const { conversationId, turnId } = await trpcMutateWithTurnLockRetry<{
        conversationId: string;
        turnId: string;
      }>({ cookie, path, input: body });
      state.conversationId = conversationId;
      state.currentTurnId = turnId;

      const segments: TurnSegment[] = [];
      const settledTools: SettledToolCall[] = [];
      const { text, hasEndedOnText } = await streamTurnText({
        cookie,
        params: { projectId: PROJECT_ID, conversationId, turnId },
        onNavigate: (href) => state.navigateHrefs.push(href),
        onNarration: (narration) => segments.push({ kind: "text", narration }),
        onSettledTool: (call) => {
          settledTools.push(call);
          segments.push({ kind: "tool", call });
          const command = (call.input as { command?: unknown } | null)?.command;
          if (typeof command === "string" && command) {
            state.toolCommands.push(command);
          }
          state.toolOutputs.push(call.output);
        },
        // Read at fire time, not captured: a tab attaches and detaches around
        // the conversation, and a captured listener would keep answering for a
        // tab that has closed.
        onUiAction: (entry) => adapterWithState.onUiAction?.(entry),
      });
      if (settledTools.length === 0) {
        return { role: "assistant", content: text };
      }
      return turnMessages({ segments, text, hasEndedOnText });
    },
  };
  const adapterWithState: LangyAdapter = Object.assign(adapter, {
    state,
    resetSession: () => {
      state.conversationId = null;
      state.currentTurnId = null;
      state.navigateHrefs.length = 0;
      state.toolCommands.length = 0;
      state.toolOutputs.length = 0;
    },
  });
  return adapterWithState;
}
