/**
 * One Langy turn over its public REST surface: the scenario's thread id is the Langy
 * conversation id, adopted on the first turn (`adoptConversationId`), so the agent keeps no
 * session of its own.
 */
import type { AgentMessage } from "langwatch/agent";

import { expectOk, type LangWatchHttp } from "./http.ts";

/** The REST surface holds a turn at most 120 s (`MAX_WAIT_SECONDS`, langy-turns.rest.ts). */
const LANGY_WAIT_SECONDS = 120;
/** Under the 300 s call cap; a widget build can outlast one wait, so it is awaited again. */
export const TURN_BUDGET_MS = 290_000;

interface LangyTurnAnswer {
  conversationId: string;
  turnId: string;
  status?: string;
  error?: unknown;
  reply?: { role: "assistant"; text: string } | null;
}

/**
 * What the app shows for a turn that ends `langy_github_not_connected`: an install prompt, not an
 * error (presentation.ts / remediation.ts). It is the only user-action code the app suppresses.
 */
const GITHUB_NOT_CONNECTED_REPLY =
  "Connect GitHub to continue. Langy needs the LangWatch GitHub App installed to open pull requests. " +
  "Install the LangWatch GitHub App (Settings → Integrations), then ask me again.";

function endedForGithubConnect({ error }: { error: unknown }): boolean {
  if (error === undefined || error === null) return false;
  const raw = typeof error === "string" ? error : JSON.stringify(error);
  return raw.includes("langy_github_not_connected");
}

/** The plain text of one message: a string, or the text parts of a part list. */
export function textOf({ message }: { message: AgentMessage }): string {
  const { content } = message;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: unknown) =>
      typeof part === "object" &&
      part !== null &&
      typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : "",
    )
    .filter((text) => text !== "")
    .join(" ");
}

/** The newest user message of the turn: from the new messages, else from the whole thread. */
export function latestUserText({
  newMessages,
  messages,
}: {
  newMessages: AgentMessage[];
  messages: AgentMessage[];
}): string {
  for (const list of [newMessages, messages]) {
    const user = [...list].reverse().find((message) => message.role === "user");
    if (user) return textOf({ message: user });
  }
  return "";
}

/** Sends one user message to Langy and waits for its reply text. */
export async function askLangy({
  http,
  conversationId,
  text,
  idempotencyKey,
  now = () => Date.now(),
}: {
  http: LangWatchHttp;
  conversationId: string;
  text: string;
  /** One per user turn, so a platform retry of the same turn lands on the same Langy turn. */
  idempotencyKey: string;
  now?: () => number;
}): Promise<{ text: string; conversationId: string }> {
  const started = now();
  for (;;) {
    const leftMs = TURN_BUDGET_MS - 15_000 - (now() - started);
    const waitSeconds = Math.max(5, Math.min(LANGY_WAIT_SECONDS, Math.floor(leftMs / 1000)));
    const answer = await http.request<LangyTurnAnswer>({
      method: "POST",
      path: `/api/langy/conversations/${encodeURIComponent(conversationId)}/messages`,
      headers: { Prefer: `wait=${waitSeconds}` },
      body: {
        messages: [{ role: "user", content: text }],
        idempotencyKey,
        adoptConversationId: true,
      },
      timeoutMs: (waitSeconds + 10) * 1000,
    });
    const body = expectOk({ answer, what: "Langy turn" });
    if (answer.status === 202) {
      // Same idempotency key: the second POST waits on the same turn, it does not start one.
      if (leftMs > 20_000) continue;
      throw new Error(`Langy did not settle within ${TURN_BUDGET_MS / 1000}s: ${answer.text}`);
    }
    if (!body.reply?.text && endedForGithubConnect({ error: body.error })) {
      return { text: GITHUB_NOT_CONNECTED_REPLY, conversationId: body.conversationId };
    }
    if (!body.reply?.text) {
      throw new Error(`Langy turn ${body.status ?? "unknown"}: ${JSON.stringify(body.error)}`);
    }
    return { text: body.reply.text, conversationId: body.conversationId };
  }
}
