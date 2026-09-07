/**
 * Whether this application serves the Prompt Studio playground chat.
 *
 * It does: the API process mounts the prompt playground's execution door
 * (`POST /api/prompt-playground/<version>/prompt.execute`), which is what the
 * Conversation tab posts to.
 */

import type { PromptPlaygroundChatAvailability } from "@langwatch/prompt-web/screens/prompt-studio";

/** What this application answers the Prompt package's playground-chat port with. */
export function promptPlaygroundChatAvailability(): PromptPlaygroundChatAvailability {
  return { available: true };
}
