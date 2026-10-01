/**
 * One row of the provider LIST the browser renders — checked, not inferred,
 * since a feature-web screen can't name the composed router. `isSystem` is
 * optional: the transport doesn't send it yet (dev/docs/plans/ui-family-move-manifests.md).
 */

import { z } from "zod";

import { customModelEntrySchema } from "./custom-model.ts";
import { modelProviderScopeSchema } from "./model-provider.ts";

export const modelProviderListEntrySchema = z
  .object({
    id: z.string(),
    provider: z.string(),
    name: z.string(),
    enabled: z.boolean(),
    disabledAt: z.date().nullable(),
    healthStatus: z.enum(["UNKNOWN", "HEALTHY", "DEGRADED", "CIRCUIT_OPEN"]).nullable(),
    customKeys: z.record(z.string(), z.unknown()).nullable(),
    deploymentMapping: z.record(z.string(), z.string()).nullable(),
    scopes: z.array(modelProviderScopeSchema),
    models: z.array(z.string()).nullable(),
    embeddingsModels: z.array(z.string()).nullable(),
    customModels: z.array(customModelEntrySchema),
    customEmbeddingsModels: z.array(customModelEntrySchema),
    /**
     * Regex sources for models allowed to skip Langy's permission checks, or null for
     * the registry default (ADR-129). Carried so the drawer can seed from the listed row.
     */
    langySkipPermissionsModels: z.array(z.string()).nullable().optional(),
    /**
     * The gateway knobs the Advanced (Gateway) accordion edits, dropped for
     * the same reason `langySkipPermissionsModels` was above (see its
     * docblock): a saved value read back as unset on reopen.
     */
    rateLimitRpm: z.number().int().nonnegative().nullable().optional(),
    rateLimitTpm: z.number().int().nonnegative().nullable().optional(),
    rateLimitRpd: z.number().int().nonnegative().nullable().optional(),
    fallbackPriorityGlobal: z.number().int().nullable().optional(),
    providerConfig: z.record(z.string(), z.unknown()).nullable().optional(),
    /** See the docblock: carried by the domain, dropped by the projection. */
    isSystem: z.boolean().optional(),
  })
  .strict();

export type ModelProviderListEntry = z.infer<typeof modelProviderListEntrySchema>;
