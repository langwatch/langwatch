/**
 * The input shapes the Model Provider tRPC surface parses.
 *
 * Kept apart from the service inputs in `model-provider.ts` on purpose. Those
 * are `.strict()` and require a non-empty id; these have always accepted (and
 * dropped) unknown keys, which is what keeps a forward-compatible client
 * working. Tightening one to match the other would turn a shrug into a
 * validation error, so the two shapes stay named separately rather than
 * collapsed into one.
 */
import { z } from "zod";
import { MODEL_ROLES } from "./catalog/model-feature-registry";
import { customModelUpdateInputSchema } from "./custom-model";
import {
  modelProviderScopeTypeSchema,
  modelProviderTestConnectionInputSchema,
  ROUTING_HANDLE_MAX_LENGTH,
  ROUTING_HANDLE_RULE,
} from "./model-provider";
import type { ModelDefaultEffective } from "./model-provider";
import type { ModelProviderListEntry } from "./model-provider-list-entry";

/**
 * The scope-assignment shape the clients send. Deliberately not the
 * contract's `modelProviderScopeSchema`, which is `.strict()`: this input has
 * always accepted (and dropped) unknown keys, and tightening it here would
 * turn a forward-compatible client into a validation error.
 */
export const modelProviderScopeAssignmentInputSchema = z.object({
  scopeType: modelProviderScopeTypeSchema,
  scopeId: z.string().min(1),
});

/**
 * Shared input shape for the provider write paths: name the tenant with
 * either handle, and refuse a request that names neither. A create with
 * no project also has to say where the credential lands, since there is
 * no project to default the scope set from.
 */
export const modelProviderTenantAnchorFields = {
  projectId: z.string().optional(),
  organizationId: z.string().optional(),
};

export function requireModelProviderTenantAnchor(
  input: { projectId?: string; organizationId?: string },
  ctx: z.RefinementCtx,
) {
  if (!input.projectId && !input.organizationId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Either projectId or organizationId is required.",
      path: ["projectId"],
    });
  }
}

/** One project, named by the surface that is reading it. */
export const modelProviderProjectTrpcInputSchema = z.object({ projectId: z.string() });

/** One organization, named by the surface that is reading it. */
export const modelProviderOrganizationTrpcInputSchema = z.object({
  organizationId: z.string(),
});

export const modelProviderUpdateTrpcInputSchema = z
  .object({
    id: z.string().optional(),
    ...modelProviderTenantAnchorFields,
    provider: z.string(),
    // Human-readable label shown in the settings list and the model
    // selector group headers. Defaults to the humanized provider name
    // (e.g. "openai" → "OpenAI") when omitted. Iter 109 added the
    // column; now exposing it on the write path so operators can
    // distinguish multiple same-provider instances at different
    // scopes.
    name: z.string().trim().min(1).max(128).optional(),
    enabled: z.boolean(),
    customKeys: z.object({}).passthrough().optional().nullable(),
    customModels: customModelUpdateInputSchema.optional().nullable(),
    customEmbeddingsModels: customModelUpdateInputSchema.optional().nullable(),
    extraHeaders: z
      .array(z.object({ key: z.string(), value: z.string() }))
      .optional()
      .nullable(),
    defaultModel: z.string().optional(),
    // The slug that addresses THIS instance in a gateway model string
    // ("eu/claude-sonnet-5"). Omitted leaves the stored handle alone;
    // an empty string clears it. The length and the message both come
    // from the same module the service validates against, so the schema
    // cannot start accepting a handle the service will refuse. The shape
    // and the reserved names are checked in the service, which owns the
    // rule the gateway reads.
    routingHandle: z
      .string()
      .max(ROUTING_HANDLE_MAX_LENGTH, ROUTING_HANDLE_RULE)
      .optional()
      .nullable(),
    // Multi-scope writes (iter 109). `scopes` is the canonical shape;
    // `scopeType`/`scopeId` remain for the transition period so older
    // callers still compile. When both arrive, `scopes` wins. The
    // service runs the fail-closed authz check on every entry before
    // persisting — any non-manageable scope aborts the whole write.
    scopes: z
      .array(modelProviderScopeAssignmentInputSchema)
      .min(1, "At least one scope must be selected.")
      .optional(),
    scopeType: modelProviderScopeTypeSchema.optional(),
    scopeId: z.string().optional(),
    // Advanced (Gateway) fields live on the same ModelProvider row.
    // Accepted on the unified write path so the drawer ships one Save
    // button across basic + advanced settings.
    rateLimitRpm: z.number().int().min(0).nullable().optional(),
    rateLimitTpm: z.number().int().min(0).nullable().optional(),
    rateLimitRpd: z.number().int().min(0).nullable().optional(),
    fallbackPriorityGlobal: z.number().int().nullable().optional(),
    providerConfig: z.object({}).passthrough().nullable().optional(),
  })
  .superRefine(requireModelProviderTenantAnchor);

export const modelProviderDeleteTrpcInputSchema = z
  .object({
    id: z.string().optional(),
    ...modelProviderTenantAnchorFields,
    provider: z.string(),
  })
  .superRefine(requireModelProviderTenantAnchor);

export const modelProviderValidateApiKeyTrpcInputSchema = z
  .object({
    ...modelProviderTenantAnchorFields,
    provider: z.string(),
    customKeys: z.record(z.string(), z.string()),
    // The scopes the credential is being set up for. Required on the
    // no-project path, where they are what the probe is authorized
    // against — see the process's credential-probe policy.
    scopes: z.array(modelProviderScopeAssignmentInputSchema).min(1).optional(),
  })
  .superRefine(requireModelProviderTenantAnchor);

/**
 * The stored-credential probe. The service input already refuses a request
 * naming neither tenant; the transport adds the same rule again so the
 * rejection arrives on the `projectId` field the form is watching.
 */
export const modelProviderTestConnectionTrpcInputSchema =
  modelProviderTestConnectionInputSchema.superRefine(requireModelProviderTenantAnchor);

export const modelProviderCodexSignInPollTrpcInputSchema = z.object({
  projectId: z.string(),
  deviceAuthId: z.string(),
  userCode: z.string(),
  scopes: z.array(modelProviderScopeAssignmentInputSchema).min(1),
  /** Langy setup + onboarding pass true: also point the allowed
   *  feature slots at the codex model. Settings passes false. */
  setAsCodingDefaults: z.boolean().default(false),
});

export const modelProviderCodexApplyCodingDefaultsTrpcInputSchema = z.object({
  projectId: z.string(),
  scopes: z.array(modelProviderScopeAssignmentInputSchema).min(1),
});

export const modelProviderIsManagedTrpcInputSchema = z.object({
  organizationId: z.string(),
  provider: z.string(),
});

export const modelProviderValidateKeyWithCustomUrlTrpcInputSchema = z.object({
  projectId: z.string(),
  provider: z.string(),
  customBaseUrl: z.string().optional(),
});

/** The scopes a default-model config attaches to, as the drawer sends them. */
export const modelDefaultScopedConfigInputSchema = z
  .array(
    z.object({
      scopeType: modelProviderScopeTypeSchema,
      scopeId: z.string().min(1),
    }),
  )
  .min(1, "Pick at least one scope.");

export const modelDefaultResolvedTrpcInputSchema = z.object({
  projectId: z.string(),
  featureKey: z.string(),
});

export const modelDefaultRoleAssignmentTrpcInputSchema = z.object({
  scopeType: modelProviderScopeTypeSchema,
  scopeId: z.string(),
  role: z.enum(MODEL_ROLES),
  model: z.string().nullable(),
});

export const modelDefaultFeatureOverrideTrpcInputSchema = z.object({
  scopeType: modelProviderScopeTypeSchema,
  scopeId: z.string(),
  featureKey: z.string(),
  model: z.string().nullable(),
});

export const modelDefaultConfigSaveTrpcInputSchema = z.object({
  id: z.string().optional(),
  config: z.record(z.string(), z.string()),
  scopes: modelDefaultScopedConfigInputSchema,
});

export const modelDefaultConfigDeleteTrpcInputSchema = z.object({ id: z.string() });

export const modelDefaultInheritedValuesTrpcInputSchema = z.object({
  projectId: z.string(),
  scopes: modelDefaultScopedConfigInputSchema,
  excludeConfigId: z.string().optional(),
});

/**
 * What the two reads the studio and the dock borrow answer.
 *
 * Both are this contract's own zod-inferred shapes.
 * `listAllForProjectForFrontend` answers the LIST PROJECTION rather than
 * `ModelProviderSummary`: the transport maps every row through the same
 * function the two `getAllForProject*` reads use, which is what
 * `ModelProviderListEntry` was declared for.
 *
 * `getResolvedDefault` answers `null` when nothing resolves — no override, no
 * role default and no provider to infer one from — and the caller falls back
 * to its own choice rather than refusing.
 */
export type ModelProviderListAllForProjectTrpcOutput = ModelProviderListEntry[];
export type ModelDefaultResolvedTrpcOutput = ModelDefaultEffective | null;
