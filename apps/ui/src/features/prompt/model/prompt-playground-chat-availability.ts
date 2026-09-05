/**
 * Whether this application serves the Prompt Studio playground chat, and the words for
 * when it does not.
 */

import type { HandledErrorFault } from "@langwatch/handled-error";
import type { PromptPlaygroundChatAvailability } from "@langwatch/prompt-web/screens/prompt-studio";

import { explainHandledError } from "@langwatch/handled-error/presentation";
import type { HandledErrorShape } from "@langwatch/handled-error/read-handled-error";

const CHAT_UNAVAILABLE: HandledErrorShape = {
  code: "prompt_playground_chat_unavailable",
  meta: {},
  // 501 rather than 404: the address is a real one this deployment does not
  // implement, which is also what the reader is being told.
  httpStatus: 501,
  fault: "platform" satisfies HandledErrorFault,
  retryable: false,
  tips: [],
  docsUrl: void 0,
  traceId: void 0,
  reasons: [],
};

/** What this application answers the Prompt package's playground-chat port with. */
export function promptPlaygroundChatAvailability(): PromptPlaygroundChatAvailability {
  const explanation = explainHandledError(CHAT_UNAVAILABLE);
  return {
    available: false,
    title: explanation.title,
    description: explanation.description,
  };
}
