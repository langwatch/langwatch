import { createHash } from "node:crypto";

import { VOICE_RUN_ID_PREFIX } from "@langwatch/scenario-contract";

/**
 * The run id a conversation writes to, derived from the conversation id
 * alone. Idempotent: hanging up twice, a reload, or a late webhook all
 * resolve to the same id, so the writer can check it already exists (AC14).
 */
export function scenarioRunIdForConversation(conversationId: string): string {
  const digest = createHash("sha256").update(conversationId).digest("hex").slice(0, 32);
  return `${VOICE_RUN_ID_PREFIX}${digest}`;
}
