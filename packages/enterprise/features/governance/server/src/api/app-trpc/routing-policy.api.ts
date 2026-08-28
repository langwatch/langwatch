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
 * every procedure answers from the Governance service and the three refusals it
 * translates are the Governance contract's. A core package may not depend on an
 * Enterprise one, so this is the side of the line the transport lives on.
 *
 * Transport only: input parsing, the typed-error translation, and delegation.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  routingPolicyScopeTypeSchema,
  RoutingPolicyModelMustBeConcreteError,
  RoutingPolicyMustHaveProviderError,
  RoutingPolicyMustHaveScopeError,
  type GovernanceService,
} from "@langwatch/enterprise-governance-contract";
import { suggestTierTargets, type SuggestTierTargetsInput } from "@langwatch/model-provider-server";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";

type RoutingPolicyApplication = Readonly<{ governance: GovernanceService }>;

/** The process supplies authentication; authorization arrives as `policy`. */
export type RoutingPolicyTrpcContext = Readonly<{
  app: RoutingPolicyApplication;
  actor(): Readonly<{ id: string }>;
}>;

type ProcedureDecorator = <TProcedure>(procedure: TProcedure) => TProcedure;

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
  policy(permission: AuthzPermission): ProcedureDecorator;
}>;

/**
 * Translate the typed empty-providers / empty-scopes guards into 422 with
 * stable codes the frontend can branch on. Anything else is rethrown untouched
 * so it degrades to a generic unknown carrying a trace id, per ADR-045.
 */
function mapServiceErrorToTrpc(err: unknown): never {
  if (err instanceof RoutingPolicyMustHaveProviderError) {
    throw new TRPCError({
      code: "UNPROCESSABLE_CONTENT",
      message: err.message,
      cause: err,
    });
  }
  if (err instanceof RoutingPolicyMustHaveScopeError) {
    throw new TRPCError({
      code: "UNPROCESSABLE_CONTENT",
      message: err.message,
      cause: err,
    });
  }
  if (err instanceof RoutingPolicyModelMustBeConcreteError) {
    throw new TRPCError({
      code: "UNPROCESSABLE_CONTENT",
      message: err.message,
      cause: err,
    });
  }
  throw err;
}

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
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      /** List policies in an organization, optionally filtered to those selectable from a scope. */
      list: policy("routingPolicies:view")(
        procedure.input(
          z.object({
            organizationId: z.string(),
            selectableForScope: z
              .object({ scopeType: scopeTypeSchema, scopeId: z.string() })
              .optional(),
          }),
        ),
      ).query(async ({ ctx, input }) =>
        ctx.app.governance.routingPolicyList({
          organizationId: input.organizationId,
          selectableForScope: input.selectableForScope,
        }),
      ),

      /** Get a single policy by id (includes its scope rows). */
      get: policy("routingPolicies:view")(procedure.input(policyIdSchema)).query(
        async ({ ctx, input }) =>
          ctx.app.governance.routingPolicyGetById({
            id: input.id,
            organizationId: input.organizationId,
          }),
      ),

      /**
       * Models worth pointing a tier at, ranked. Server-side because the model
       * catalog is far too large to ship to the browser; the tier names and
       * labels themselves are client-safe.
       */
      tierSuggestions: policy("routingPolicies:view")(
        procedure.input(
          z.object({
            organizationId: z.string(),
            tier: tierSchema,
            boundProviderTypes: z.array(z.string()).default([]),
          }),
        ),
      ).query(({ input }) =>
        suggestTierTargets({
          tier: input.tier,
          boundProviderTypes: input.boundProviderTypes,
        }),
      ),

      create: policy("routingPolicies:manage")(
        procedure.input(
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
        ),
      ).mutation(async ({ ctx, input }) => {
        try {
          return await ctx.app.governance.routingPolicyCreate({
            organizationId: input.organizationId,
            scopes: input.scopes,
            name: input.name,
            description: input.description ?? null,
            modelProviderIds: input.modelProviderIds,
            isDefault: input.isDefault,
            modelAliases: input.modelAliases,
            defaultModel: input.defaultModel ?? null,
            policyRules: input.policyRules,
            actorUserId: ctx.actor().id,
          });
        } catch (err) {
          mapServiceErrorToTrpc(err);
        }
      }),

      update: policy("routingPolicies:manage")(
        procedure.input(
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
        ),
      ).mutation(async ({ ctx, input }) => {
        try {
          return await ctx.app.governance.routingPolicyUpdate({
            id: input.id,
            organizationId: input.organizationId,
            name: input.name,
            description: input.description,
            modelProviderIds: input.modelProviderIds,
            modelAliases: input.modelAliases,
            defaultModel: input.defaultModel,
            policyRules: input.policyRules,
            actorUserId: ctx.actor().id,
          });
        } catch (err) {
          mapServiceErrorToTrpc(err);
        }
      }),

      setDefault: policy("routingPolicies:manage")(procedure.input(policyIdSchema)).mutation(
        async ({ ctx, input }) =>
          ctx.app.governance.routingPolicySetDefault({
            id: input.id,
            organizationId: input.organizationId,
            actorUserId: ctx.actor().id,
          }),
      ),

      delete: policy("routingPolicies:manage")(procedure.input(policyIdSchema)).mutation(
        async ({ ctx, input }) => {
          await ctx.app.governance.routingPolicyDelete({
            id: input.id,
            organizationId: input.organizationId,
          });
          return { ok: true };
        },
      ),
    });
  }
}
