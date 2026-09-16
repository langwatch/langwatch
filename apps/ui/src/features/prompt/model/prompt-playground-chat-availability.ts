/**
 * Whether this application serves the Prompt Studio playground chat: yes
 * — the API mounts the execution door the Conversation tab posts to
 * (`POST /api/prompt-playground/<version>/prompt.execute`).
 */

import type { PromptPlaygroundChatAvailability } from "@langwatch/prompt-web/prompt-studio";

/** What this application answers the Prompt package's playground-chat port with. */
export function promptPlaygroundChatAvailability(): PromptPlaygroundChatAvailability {
  return { available: true };
}
