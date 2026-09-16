import { modelDisplayLabel } from "@langwatch/model-provider-contract";
import { displayFirstName } from "./display-first-name.ts";

/**
 * Who the two sides of a playground conversation are: the person reading
 * and the model picked - not "User"/"Assistant", since a session iterates
 * one prompt across models. An unnamed side falls back to its role label.
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
 * no provider prefix. A bare id keeps its whole self, since
 * `modelDisplayLabel` would otherwise drop it past a slash it doesn't have.
 */
function modelLabel(model?: string | null): string | undefined {
  const fullModelId = model?.trim();
  if (!fullModelId) return undefined;
  return modelDisplayLabel({ fullModelId }) || fullModelId;
}
