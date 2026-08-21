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

import type {
  AgentAdapter,
  AgentInput,
  AgentReturnTypes,
} from "@langwatch/scenario";
import { AgentRole } from "@langwatch/scenario";
import { ADMIN_EMAIL, ADMIN_PASSWORD, APP_BASE, PROJECT_ID } from "./config";

interface TurnPart {
  type: string;
  text?: string;
  [key: string]: unknown;
}
interface TurnMessage {
  role: "user" | "assistant" | "system";
  parts: TurnPart[];
}
interface LangySessionState {
  conversationId: string | null;
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
      const res = await fetch(`${APP_BASE}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: APP_BASE },
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        throw new Error(
          `Langy test sign-in failed: ${res.status} ${await res.text()}`,
        );
      }
      const setCookie = res.headers.get("set-cookie") ?? "";
      // better-auth only applies the __Secure- prefix on HTTPS origins, so a
      // plain-http local stack sets the bare cookie name. Accept both.
      const match = /(?:__Secure-)?better-auth\.session_token=[^;]+/.exec(
        setCookie,
      );
      if (!match) {
        throw new Error(
          "Langy test sign-in: no better-auth session cookie in response",
        );
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
    // measured completing server-side at 135s. Aborting earlier and retrying
    // is worse — the retry races the accepted first attempt into
    // langy_turn_in_progress.
    signal: AbortSignal.timeout(180_000),
  });
  const body: any = await res.json().catch(() => null);
  if (!res.ok || !body || body.error) {
    // The tRPC error envelope nests the domain code at data.error.code (see
    // the langy_turn_in_progress payload: {"json":{"data":{"error":{"code":
    // "langy_turn_in_progress"}}}}). The old data.domainError.code path never
    // matched anything, which silently disabled the turn-lock retry below.
    const domainErrorCode =
      body?.error?.json?.data?.error?.code ??
      body?.error?.json?.data?.domainError?.code;
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
 */
export function isTransientInfrastructureError(error: unknown): boolean {
  return (
    (error as { transientInfrastructure?: boolean } | null)
      ?.transientInfrastructure === true
  );
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
    tips: Array.isArray(tips)
      ? tips.filter((tip): tip is string => typeof tip === "string")
      : [],
  };
}

/** One settled tool call observed on the turn stream, as the panel showed it. */
export interface SettledToolCall {
  id: string;
  name: string;
  input: unknown;
  output: string;
  isError: boolean;
}

/** Reads the onTurnStream SSE frames until the server closes the response. */
async function streamTurnText({
  cookie,
  params,
  onNavigate,
  onSettledTool,
}: {
  cookie: string;
  params: { projectId: string; conversationId: string; turnId: string };
  /** Called for each navigate entry on the stream (live-only, never durable). */
  onNavigate?: (href: string) => void;
  /** Called for each settled tool card on the stream, in order. */
  onSettledTool?: (call: SettledToolCall) => void;
}): Promise<string> {
  const input = encodeURIComponent(JSON.stringify({ json: params }));
  const res = await fetch(
    `${APP_BASE}/api/sse/langy.onTurnStream?input=${input}`,
    {
      headers: { Cookie: cookie, Accept: "text/event-stream" },
      signal: AbortSignal.timeout(240_000),
    },
  );
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
        textAfterLastTool = "";
        sawTool = true;
        if (entry.phase === "end") {
          toolSeq += 1;
          onSettledTool?.({
            id:
              typeof entry.id === "string" && entry.id
                ? entry.id
                : `tool-${toolSeq}`,
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
          assistantText += `\`\`\`langy-card\n${
            parsed.tips[0] ??
            "The LangWatch GitHub App is not installed for this project."
          }\n\`\`\``;
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
    return textAfterLastTool.replace(/^[\s]+/, "");
  }
  // Whitespace is truthy, so a turn whose only deltas were blank lines would
  // otherwise be handed to the judge as a reply the user cannot see.
  if (assistantText.trim()) return assistantText;

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

export function makeLangyAdapter(): AgentAdapter & {
  state: LangySessionState;
} {
  const state: LangySessionState = {
    conversationId: null,
    navigateHrefs: [],
    toolCommands: [],
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

      const settledTools: SettledToolCall[] = [];
      const text = await streamTurnText({
        cookie,
        params: { projectId: PROJECT_ID, conversationId, turnId },
        onNavigate: (href) => state.navigateHrefs.push(href),
        onSettledTool: (call) => {
          settledTools.push(call);
          const command = (call.input as { command?: unknown } | null)?.command;
          if (typeof command === "string" && command) {
            state.toolCommands.push(command);
          }
        },
      });
      if (settledTools.length === 0) {
        return { role: "assistant", content: text };
      }
      // The product's tool cards ride as real tool traffic: the judge sees a
      // native tool-call/tool-result exchange (the retrieval that grounds the
      // reply's claims), the user simulator sees the framework's compact
      // summaries of it, and the reply text stays exactly the prose the panel
      // renders.
      return [
        {
          role: "assistant",
          content: settledTools.map((call) => ({
            type: "tool-call" as const,
            toolCallId: call.id,
            toolName: call.name,
            input: call.input,
          })),
        },
        {
          role: "tool",
          content: settledTools.map((call) => ({
            type: "tool-result" as const,
            toolCallId: call.id,
            toolName: call.name,
            // The server already bounds tool output (8KB canonical reduction);
            // mirror that bound rather than cutting deeper — a tighter slice
            // has cost a judge the very count a reply was grounded on.
            output: {
              type: call.isError ? ("error-text" as const) : ("text" as const),
              value: call.output.slice(0, 8192),
            },
          })),
        },
        { role: "assistant", content: text },
      ];
    },
  };
  return Object.assign(adapter, { state });
}
