/**
 * One process per organization: each retention extension or apply request becomes one
 * `applyToProjects` intent, keyed by its identity, which the outbox runs and retries. Pure.
 */
import { retentionCategorySchema, retentionScopeSchema } from "@langwatch/data-retention-contract";
import type { EventHandler, IntentSpec } from "@langwatch/eventing";
import { z } from "zod";

import {
  storedRetentionModeSchema,
  type RetentionExtendedEventData,
  type StoredRetentionApplyRequestedEventData,
} from "./retention-extension.events.ts";

export const RETENTION_EXTENSION_APPLY_PROCESS_NAME = "retentionExtensionApply";

export const retentionExtensionApplySchema = z.object({
  organizationId: z.string().min(1),
  extensionId: z.string().min(1),
  /** The scope whose projects are reached; absent reaches the whole organization. */
  scope: z.object({ scopeType: retentionScopeSchema, scopeId: z.string().min(1) }).optional(),
  mode: storedRetentionModeSchema.default("raise"),
  categories: z.array(retentionCategorySchema).min(1),
  at: z.number().int().nonnegative(),
});
export type RetentionExtensionApply = z.input<typeof retentionExtensionApplySchema>;

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
        ...(data.scope ? { scope: data.scope } : {}),
        mode: "raise",
        categories: data.retention.map((each) => each.category),
        at: ctx.at,
      }),
    ],
  };
};

/** An apply request fans out the exact rewrite, keyed by the request. */
export const storedRetentionApplyRequested: EventHandler<
  RetentionExtensionApplyState,
  StoredRetentionApplyRequestedEventData,
  RetentionExtensionApplyIntents
> = (state, data, ctx) => {
  if (state.lastExtensionId === data.requestId) return { state };
  return {
    state: { lastExtensionId: data.requestId },
    intents: [
      ctx.intent("applyToProjects", `apply:${data.requestId}`, {
        organizationId: data.organizationId,
        extensionId: data.requestId,
        scope: data.scope,
        mode: "apply",
        categories: data.categories,
        at: ctx.at,
      }),
    ],
  };
};
