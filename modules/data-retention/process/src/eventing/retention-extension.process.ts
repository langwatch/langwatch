/**
 * One process per organization: each retention extension becomes one `applyToProjects` intent,
 * keyed by the extension, which the outbox runs and retries. Pure and synchronous.
 */
import { retentionCategorySchema } from "@langwatch/data-retention-contract";
import type { EventHandler, IntentSpec } from "@langwatch/eventing";
import { z } from "zod";

import type { RetentionExtendedEventData } from "./retention-extension.events.ts";

export const RETENTION_EXTENSION_APPLY_PROCESS_NAME = "retentionExtensionApply";

export const retentionExtensionApplySchema = z.object({
  organizationId: z.string().min(1),
  extensionId: z.string().min(1),
  categories: z.array(retentionCategorySchema).min(1),
  at: z.number().int().nonnegative(),
});
export type RetentionExtensionApply = z.infer<typeof retentionExtensionApplySchema>;

export const retentionExtensionApplyStateSchema = z.object({
  lastExtensionId: z.string().nullable(),
});
type RetentionExtensionApplyState = z.infer<typeof retentionExtensionApplyStateSchema>;

export const RETENTION_EXTENSION_APPLY_INITIAL_STATE: RetentionExtensionApplyState = {
  lastExtensionId: null,
};

type RetentionExtensionApplyIntents = {
  applyToProjects: IntentSpec<typeof retentionExtensionApplySchema>;
};

/** A replayed extension already asked for asks for nothing; the intent key absorbs the rest. */
export const retentionExtended: EventHandler<
  RetentionExtensionApplyState,
  RetentionExtendedEventData,
  RetentionExtensionApplyIntents
> = (state, data, ctx) => {
  if (state.lastExtensionId === data.extensionId) return { state };
  return {
    state: { lastExtensionId: data.extensionId },
    intents: [
      ctx.intent("applyToProjects", `apply:${data.extensionId}`, {
        organizationId: data.organizationId,
        extensionId: data.extensionId,
        categories: data.retention.map((each) => each.category),
        at: ctx.at,
      }),
    ],
  };
};
