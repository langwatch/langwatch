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
}

let cachedCookie: Promise<string> | null = null;

/** Sign in once (per test process) and cache the better-auth session cookie. */
function getSessionCookie(): Promise<string> {
  cachedCookie ??= (async () => {
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
    const match = /__Secure-better-auth\.session_token=[^;]+/.exec(setCookie);
    if (!match) {
      throw new Error(
        "Langy test sign-in: no better-auth session cookie in response",
      );
    }
    return match[0];
  })();
  return cachedCookie;
}

/** Mirror langyChatTransport.ts's message shape: {role, parts: [{type, text}]}. */
function toTurnMessage(msg: {
  role: string;
  content: unknown;
}): TurnMessage {
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
    signal: AbortSignal.timeout(60_000),
  });
  const body: any = await res.json().catch(() => null);
  if (!res.ok || !body || body.error) {
    const domainErrorCode = body?.error?.json?.data?.domainError?.code;
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
 * go stale. In practice, an 80s×10-attempt retry (comfortably longer than
 * this stack's observed 35-65s real turn duration) still hit the SAME 409 —
 * that rules out "still genuinely processing" and points at the projection
 * never flipping back off RUNNING (a likely event-sourcing projection lag
 * under rapid back-to-back turns, not something a longer wait fixes). Flag
 * this as a real product finding rather than retry around it indefinitely;
 * keep only a short retry here in case a given instance IS the legitimate
 * few-second race.
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
  const maxAttempts = 3;
  const delayMs = 5_000;
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

/** Reads the onTurnStream SSE frames until the server closes the response. */
async function streamTurnText({
  cookie,
  params,
}: {
  cookie: string;
  params: { projectId: string; conversationId: string; turnId: string };
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
    throw new Error(
      `Langy onTurnStream -> ${res.status}: ${await res.text()}`,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let assistantText = "";
  let streamError: string | null = null;

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
      } else if (entry.type === "error") {
        // The server emits errorText (see langyChatTransport.ts's onEntry
        // "error" case), not message — checking the wrong field silently
        // swallowed every real error message behind a generic placeholder.
        streamError =
          typeof entry.errorText === "string"
            ? entry.errorText
            : `Langy stream error (raw: ${JSON.stringify(entry)})`;
      }
      // "end" (turn finished) / "complete" (SSE stream finished) / "connected"
      // / "status" carry no assistant text — nothing further to accumulate.
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

  if (streamError) throw new Error(`Langy turn error: ${streamError}`);
  return assistantText || "(no response)";
}

export function makeLangyAdapter(): AgentAdapter & {
  state: LangySessionState;
} {
  const state: LangySessionState = { conversationId: null };
  const adapter: AgentAdapter = {
    role: AgentRole.AGENT,
    call: async (input: AgentInput): Promise<AgentReturnTypes> => {
      const cookie = await getSessionCookie();
      const messages = input.messages.map((m: any) => toTurnMessage(m));
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

      const text = await streamTurnText({
        cookie,
        params: { projectId: PROJECT_ID, conversationId, turnId },
      });
      return { role: "assistant", content: text };
    },
  };
  return Object.assign(adapter, { state });
}
