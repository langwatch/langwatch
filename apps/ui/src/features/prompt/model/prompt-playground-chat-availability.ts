/**
 * Whether this application serves the Prompt Studio playground chat, and the
 * words for when it does not.
 *
 * IT DOES NOT, AND THE REFUSAL IS DELIBERATE. The chat posts to
 * `/api/copilotkit`, and the API process declares that family absent at boot
 * with its own sentence: "API process serves no /api/copilotkit: the
 * prompt-studio adapter it dispatches through reaches the retired studio
 * post-event module, the platform Lambda runtime and a browser package, none of
 * which a server composition may hold"
 * (`apps/api/src/app/api-packaged-rest.composition.ts`). It is a boundary
 * refusal, not a collaborator someone forgot to wire, and the extraction ledger
 * records it as kept.
 *
 * What the ledger ALSO records is that only the server half was ever dealt
 * with: "the browser still points `runtimeUrl` at `/api/copilotkit`
 * (`prompt-playground-chat.tsx`), so the prompt-studio playground chat 404s
 * rather than merely being unmigrated". That is what this module closes. The
 * surface is not deleted — nothing says the playground is retired, and the day
 * a runtime is mounted this becomes `{ available: true }` and the chat is back
 * — it is declared absent, in the one place that knows.
 *
 * The words come from the code-keyed presentation registry rather than from
 * here, for the reason every customer-facing sentence in this application does:
 * `code` is what a failure carries, and the registry is where what a customer
 * reads about a code lives.
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
