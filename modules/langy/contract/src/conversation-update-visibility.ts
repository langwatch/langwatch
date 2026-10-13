import { z } from "zod";

/** User-scoping predicate for Langy conversation freshness broadcasts. */
const langyConversationUpdateAuthFieldsSchema = z.looseObject({
  ownerUserId: z.unknown().optional(),
  isShared: z.unknown().optional(),
});
export type LangyConversationUpdateAuthFields = z.infer<
  typeof langyConversationUpdateAuthFieldsSchema
>;

export function canUserSeeLangyConversationUpdate(
  fields: LangyConversationUpdateAuthFields & { userId: string },
): boolean {
  if (fields.isShared === true) return true;
  return (
    typeof fields.ownerUserId === "string" &&
    fields.ownerUserId.length > 0 &&
    fields.ownerUserId === fields.userId
  );
}

export function isLangyConversationUpdateVisibleToUser(input: {
  eventPayload: unknown;
  userId: string;
}): boolean {
  if (typeof input.eventPayload !== "string") return false;
  try {
    const parsed = langyConversationUpdateAuthFieldsSchema.parse(JSON.parse(input.eventPayload));
    return canUserSeeLangyConversationUpdate({ ...parsed, userId: input.userId });
  } catch {
    return false;
  }
}
