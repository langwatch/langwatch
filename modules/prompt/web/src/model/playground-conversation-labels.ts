import { modelDisplayLabel } from "@langwatch/model-provider-contract";
import { displayFirstName } from "./display-first-name.ts";

/**
 * Who the two sides of a playground conversation are: the person reading
 * (not "User") and the model they picked (not "Assistant"), since a session
 * iterates one prompt across models and "Assistant" wouldn't say which. A
 * side we cannot name is left unset, so the thread falls back to its role label.
 */
export function playgroundConversationLabels({
  userName,
  model,
}: {
  userName?: string | null;
  model?: string | null;
}): { user?: string; assistant?: string } {
  return {
    user: displayFirstName({ name: userName }) ?? undefined,
    assistant: modelLabel(model),
  };
}

/**
 * The model's name as the rest of the product writes it: family name only,
 * no provider prefix. A bare id with no prefix keeps its whole self, since
 * `modelDisplayLabel` would otherwise drop the entire string past the first
 * slash it doesn't have.
 */
function modelLabel(model?: string | null): string | undefined {
  const fullModelId = model?.trim();
  if (!fullModelId) return undefined;
  return modelDisplayLabel({ fullModelId }) || fullModelId;
}
