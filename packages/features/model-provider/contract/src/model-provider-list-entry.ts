/**
 * One row of the provider LIST the browser renders.
 *
 * `listAllForProjectForFrontend` and `listAllForOrganizationForFrontend` both
 * answer an array of these, and until now the shape was declared inline in
 * `@langwatch/model-provider-server`'s tRPC transport and read on the browser
 * side through `inferRouterOutputs<AppRouter>`. That inference is exactly what
 * a screen in a feature-web package cannot do — it names the composed router,
 * which lives in the process — so the declaration moves here and both halves
 * are checked against it.
 *
 * NOT the same shape as `LegacyModelProvider`. That one is the full editor
 * payload the drawer reads; this is the narrower list projection, and the two
 * spell `customModels` differently (`{ modelId, displayName, mode }` here,
 * `Model` there). Kept apart rather than merged: widening the list to the
 * editor payload would put every provider's `extraHeaders` and `providerConfig`
 * on the settings page's wire.
 *
 * NO CREDENTIAL VALUE TRAVELS ON THIS TYPE. `customKeys` is the masked record
 * the service produces — the decrypted keys are only ever handed to
 * server-internal callers of `getExecutionProviders` — and the settings table
 * renders none of it. Widening this declaration to carry a readable credential
 * would put one on a wire that ends in a browser.
 *
 * `isSystem` IS DECLARED OPTIONAL BECAUSE THE TRANSPORT DOES NOT SEND IT. The
 * canonical provider carries the flag (`platform/app/src/runtime/app/features/model-provider.ts`
 * sets it on the env-fed pseudo-rows), the transport's projection drops it, and
 * the settings page has been reading `(provider as any).isSystem` — so its
 * "System" scope chip and its read-only row have never rendered. Declaring the
 * field honestly is what makes that visible; adding it to the projection is a
 * behaviour change and belongs to whoever owns the providers table next. See
 * `dev/docs/plans/ui-family-move-manifests.md`.
 */

import { z } from "zod";
import { customModelEntrySchema } from "./custom-model";
import { modelProviderScopeSchema } from "./model-provider";

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
    /** See the docblock: carried by the domain, dropped by the projection. */
    isSystem: z.boolean().optional(),
  })
  .strict();

export type ModelProviderListEntry = z.infer<typeof modelProviderListEntrySchema>;
