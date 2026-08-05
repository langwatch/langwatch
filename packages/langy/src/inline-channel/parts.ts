/**
 * The typed message parts the inline card channel adds to the durable event stream
 * (ADR-060 §1, §6, §8) — the relay PRODUCES these, the browser PARSES them,
 * so the contract lives here where both runtimes import it.
 *
 *   - `langy-card`         a stamped card, in place of its fence, between
 *                          the prose parts it sat among. The one decision
 *                          point's output; downstream reads it, never
 *                          re-parses text.
 *   - `langy-card-failed`  a card that could not be salvaged or did not
 *                          validate. It carries the raw fenced text so the
 *                          disclosure can show it — a failure may never be
 *                          quieter than a success.
 *   - `langy-choice-selection`  the structured half of a choices answer,
 *                          riding the next USER message beside its readable
 *                          text ("Chose: X"). The UI binds by blockId; the
 *                          model just reads the words.
 */
import * as z from "zod/v4";

import { langyChoiceSelectionSchema } from "./choices";
import {
  DERIVED_SAFE_CARD_KINDS,
  langyDerivedCardSchema,
  langyCardHintSchema,
} from "../cards/derived-safe.js";

export const LANGY_CARD_PART_TYPE = "langy-card";
export const LANGY_CARD_FAILED_PART_TYPE = "langy-card-failed";
export const LANGY_CHOICE_SELECTION_PART_TYPE = "langy-choice-selection";

export const langyCardPartSchema = z
  .object({
    type: z.literal(LANGY_CARD_PART_TYPE),
    blockId: z.string().min(1),
    kind: z.enum(DERIVED_SAFE_CARD_KINDS),
    /** Always "derived" — the provenance chrome keys off this, never off kind. */
    provenance: z.literal("derived"),
    card: langyDerivedCardSchema,
    hints: z.array(langyCardHintSchema).optional(),
  })
  .refine(
    (part) => part.kind === part.card.kind && part.blockId === part.card.blockId,
    { message: "part identity must match the stamped card" },
  );
export type LangyCardPart = z.infer<typeof langyCardPartSchema>;

export const langyCardFailedPartSchema = z.object({
  type: z.literal(LANGY_CARD_FAILED_PART_TYPE),
  blockId: z.string().min(1),
  /** The raw fenced text, for the disclosure's expanded view. */
  raw: z.string(),
});
export type LangyCardFailedPart = z.infer<typeof langyCardFailedPartSchema>;

export const langyChoiceSelectionPartSchema = z
  .object({
    type: z.literal(LANGY_CHOICE_SELECTION_PART_TYPE),
  })
  .and(langyChoiceSelectionSchema);
export type LangyChoiceSelectionPart = z.infer<
  typeof langyChoiceSelectionPartSchema
>;

/** Parse an opaque message part as a stamped card part, or null. */
export function parseLangyCardPart(part: unknown): LangyCardPart | null {
  const parsed = langyCardPartSchema.safeParse(part);
  return parsed.success ? parsed.data : null;
}

/** Parse an opaque message part as a failed-card part, or null. */
export function parseLangyCardFailedPart(
  part: unknown,
): LangyCardFailedPart | null {
  const parsed = langyCardFailedPartSchema.safeParse(part);
  return parsed.success ? parsed.data : null;
}

/** Parse an opaque message part as a choice selection, or null. */
export function parseLangyChoiceSelectionPart(
  part: unknown,
): LangyChoiceSelectionPart | null {
  const parsed = langyChoiceSelectionPartSchema.safeParse(part);
  return parsed.success ? parsed.data : null;
}
