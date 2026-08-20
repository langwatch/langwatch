import { modelDisplayLabel } from "~/server/modelProviders/customModelDisplayNames";
import { displayFirstName } from "~/utils/displayName";

/**
 * Who the two sides of a playground conversation are.
 *
 * "User" and "Assistant" name neither of them on this surface. One side is the
 * person reading, who is writing the messages themselves rather than reading
 * back somebody else's transcript. The other is the model they picked, which
 * is the thing they are iterating on: a playground session is a run of the
 * same prompt against one model and then another, and a transcript labelled
 * "Assistant" says nothing about which of them produced it once the picker has
 * moved on.
 *
 * The prompt's own handle was the other candidate for that side. It loses
 * because it is the constant in the comparison and the model is the variable,
 * and because a saved prompt already names itself in the tab beside the
 * conversation.
 *
 * A side we cannot name is left unset rather than blank, so the thread falls
 * back to the role label it already had instead of drawing an empty chip.
 */
export function playgroundConversationLabels({
  userName,
  model,
}: {
  userName?: string | null;
  model?: string | null;
}): { user?: string; assistant?: string } {
  return {
    user: displayFirstName(userName) ?? undefined,
    assistant: modelLabel(model),
  };
}

/**
 * The model's name as the rest of the product writes it: the family name the
 * model picker and the default-models table show, without the provider prefix
 * the id carries.
 *
 * A bare id with no prefix keeps its whole self. `modelDisplayLabel` drops
 * everything before the first slash, which for such an id is the entire
 * string, and a bubble labelled with an empty chip is worse than one labelled
 * "Assistant".
 */
function modelLabel(model?: string | null): string | undefined {
  const fullModelId = model?.trim();
  if (!fullModelId) return undefined;
  return modelDisplayLabel({ fullModelId }) || fullModelId;
}
