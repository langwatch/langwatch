/**
 * Admin-defined routing policies over the process's tRPC transport.
 *
 * Multi-scope contract: inputs accept a `scopes[]` array of
 * {scopeType, scopeId} entries. The legacy single-scope {scope, scopeId} shape
 * is gone — callers use the array form.
 *
 * Organization-level `routingPolicies:manage` gates every mutation; members may
 * list and read.
 *
 * The surface belongs to routing rather than to the gateway package because
 * every procedure answers from the governance application and the three
 * refusals it raises are the Governance contract's. A core package may not
 * depend on an Enterprise one, so this is the side of the line the transport
 * lives on.
 *
 * Transport only: input parsing and delegation. The refusals are the
 * application's, raised as handled errors with stable codes that the process's
 * boundary renders — a transport does not construct a transport error.
 */
import { createTrpcService, type TrpcPolicyDecorator } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  governanceWriteAcknowledgedSchema,
  routingPolicySchema,
  routingPolicyScopeTypeSchema,
} from "@langwatch/enterprise-governance-contract";
import {
  suggestTierTargets,
  tierTargetSuggestionSchema,
  type SuggestTierTargetsInput,
} from "@langwatch/model-provider-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import type { GovernanceApp } from "#app/governance.app";

/**
 * The process supplies authentication; authorization arrives as `policy`.
 *
 * `app` is the slice of the process's application this feature reaches, not
 * the feature's application itself, because a tRPC root is shared by every
 * feature mounted on it and so carries all of them.
 */
export type RoutingPolicyTrpcContext = Readonly<{
  app: Readonly<{ governanceApp: GovernanceApp }>;
  actor(): Readonly<{ id: string }>;
}>;

type RoutingPolicyTrpcProcedures<
  TContext extends RoutingPolicyTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * Tracing, logging, error shaping, scope lineage, the check and audit,
   * applied AFTER this feature's input parser: tRPC runs middlewares in the
   * order they were added, and the check reads its scope id from the validated
   * input.
   */
  policy(permission: AuthzPermission): TrpcPolicyDecorator;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
}>;

const scopeTypeSchema = routingPolicyScopeTypeSchema;
const scopesArraySchema = z
  .array(z.object({ scopeType: scopeTypeSchema, scopeId: z.string() }))
  .min(1, "Routing policy must include at least one scope");
const aliasesSchema = z.record(z.string(), z.string()).optional();
/**
 * A concrete, provider-qualified model id. Never a moving name: writing
 * "openai/latest" here would make the gateway dispatch a model literally
 * called "latest".
 */
const defaultModelSchema = z.string().min(1).max(256).nullable().optional();
const policyRulesSchema = z.record(z.string(), z.unknown()).optional();

/**
 * The tiers a policy can point at. Annotated against the suggester's own input
 * so a tier added there is a compile error here rather than a value this
 * surface silently refuses.
 */
const tierSchema: z.ZodType<SuggestTierTargetsInput["tier"]> = z.enum([
  "complex",
  "reasoning",
  "fast",
]);

const policyIdSchema = z.object({ organizationId: z.string(), id: z.string() });

/** Installs the complete `routingPolicy.*` tRPC surface on a process root. */
export class RoutingPolicyTrpcApi {
  static create<
    TContext extends RoutingPolicyTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: RoutingPolicyTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy, validateOutput } = procedures;

    return createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .query("list", (p) =>
        p
          .withInput(
            z.object({
              organizationId: z.string(),
              selectableForScope: z
                .object({ scopeType: scopeTypeSchema, scopeId: z.string() })
                .optional(),
            }),
          )
          .withOutput(routingPolicySchema.array())
          .withPermission("routingPolicies:view")
          /**
           * Policies in an organization, optionally filtered to those
           * selectable from one scope.
           */
          .handle(async ({ ctx, input }) =>
            ctx.app.governanceApp.listRoutingPolicies({
              organizationId: input.organizationId,
              selectableForScope: input.selectableForScope,
            }),
          ),
      )
      .query("get", (p) =>
        p
          .withInput(policyIdSchema)
          .withOutput(routingPolicySchema)
          .withPermission("routingPolicies:view")
          /** One policy by id, with its scope rows. */
          .handle(async ({ ctx, input }) =>
            ctx.app.governanceApp.getRoutingPolicy({
              id: input.id,
              organizationId: input.organizationId,
            }),
          ),
      )
      .query("tierSuggestions", (p) =>
        p
          .withInput(
            z.object({
              organizationId: z.string(),
              tier: tierSchema,
              boundProviderTypes: z.array(z.string()).default([]),
            }),
          )
          .withOutput(tierTargetSuggestionSchema.array())
          .withPermission("routingPolicies:view")
          /**
           * Models worth pointing a tier at, ranked. Server-side because the
           * model catalog is far too large to ship to the browser; the tier
           * names and labels themselves are client-safe.
           */
          .handle(({ input }) =>
            suggestTierTargets({
              tier: input.tier,
              boundProviderTypes: input.boundProviderTypes,
            }),
          ),
      )
      .mutation("create", (p) =>
        p
          .withInput(
            z.object({
              organizationId: z.string(),
              scopes: scopesArraySchema,
              name: z.string().min(1).max(128),
              description: z.string().nullable().optional(),
              modelProviderIds: z
                .array(z.string())
                .min(1, "Routing policy must reference at least one provider credential"),
              isDefault: z.boolean().default(false),
              modelAliases: aliasesSchema,
              defaultModel: defaultModelSchema,
              policyRules: policyRulesSchema,
            }),
          )
          .withOutput(routingPolicySchema)
          .withPermission("routingPolicies:manage")
          .handle(async ({ ctx, input }) =>
            ctx.app.governanceApp.createRoutingPolicy(
              {
                organizationId: input.organizationId,
                scopes: input.scopes,
                name: input.name,
                description: input.description ?? null,
                modelProviderIds: input.modelProviderIds,
                isDefault: input.isDefault,
                modelAliases: input.modelAliases,
                defaultModel: input.defaultModel ?? null,
                policyRules: input.policyRules,
              },
              ctx.actor(),
            ),
          ),
      )
      .mutation("update", (p) =>
        p
          .withInput(
            z.object({
              organizationId: z.string(),
              id: z.string(),
              name: z.string().min(1).max(128).optional(),
              description: z.string().nullable().optional(),
              modelProviderIds: z
                .array(z.string())
                .min(1, "Routing policy must reference at least one provider credential")
                .optional(),
              modelAliases: aliasesSchema,
              defaultModel: defaultModelSchema,
              policyRules: policyRulesSchema,
            }),
          )
          .withOutput(routingPolicySchema)
          .withPermission("routingPolicies:manage")
          .handle(async ({ ctx, input }) =>
            ctx.app.governanceApp.updateRoutingPolicy(
              {
                id: input.id,
                organizationId: input.organizationId,
                name: input.name,
                description: input.description,
                modelProviderIds: input.modelProviderIds,
                modelAliases: input.modelAliases,
                defaultModel: input.defaultModel,
                policyRules: input.policyRules,
              },
              ctx.actor(),
            ),
          ),
      )
      .mutation("setDefault", (p) =>
        p
          .withInput(policyIdSchema)
          .withOutput(routingPolicySchema)
          .withPermission("routingPolicies:manage")
          .handle(async ({ ctx, input }) =>
            ctx.app.governanceApp.setDefaultRoutingPolicy(
              { id: input.id, organizationId: input.organizationId },
              ctx.actor(),
            ),
          ),
      )
      .mutation("delete", (p) =>
        p
          .withInput(policyIdSchema)
          .withOutput(governanceWriteAcknowledgedSchema)
          .withPermission("routingPolicies:manage")
          .handle(async ({ ctx, input }) => {
            await ctx.app.governanceApp.deleteRoutingPolicy({
              id: input.id,
              organizationId: input.organizationId,
            });
            return { ok: true };
          }),
      )
      .build();
  }
}
