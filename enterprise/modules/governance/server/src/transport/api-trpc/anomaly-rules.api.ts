/**
 * AnomalyRule admin CRUD tRPC surface. Reads on `anomalyRules:view`, writes on
 * `anomalyRules:manage`.
 * Spec: specs/ai-gateway/governance/anomaly-rules.feature
 */
import { createTrpcService, type TrpcPolicyDecorator } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  ANOMALY_RULE_SCOPES,
  anomalyRuleSchema,
  ANOMALY_RULE_SEVERITIES,
  type AnomalyRule,
  type GovernanceApi,
  redactDestinationConfig,
} from "@langwatch/enterprise-governance-contract";
import { isZodLikeError, ValidationError } from "@langwatch/handled-error";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";

export type AnomalyRulesTrpcContext = Readonly<{
  app: Readonly<{ governance: GovernanceApi }>;
  actor(): Readonly<{ id: string }>;
}>;

type AnomalyRulesTrpcProcedures<
  TContext extends AnomalyRulesTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  policy(permission: AuthzPermission): TrpcPolicyDecorator;
  /** Refuses off-plan callers with the `ANOMALY_RULES` refusal copy. */
  planGate: TrpcPolicyDecorator;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
}>;

const severitySchema = z.enum(ANOMALY_RULE_SEVERITIES);
const scopeSchema = z.enum(ANOMALY_RULE_SCOPES);
const statusSchema = z.enum(["active", "disabled"]);
const organizationScope = z.object({ organizationId: z.string() });
const idAndOrg = organizationScope.extend({ id: z.string() });

const createSchema = organizationScope.extend({
  name: z.string().min(1).max(128),
  description: z.string().nullable().optional(),
  severity: severitySchema,
  ruleType: z.string().min(1).max(64),
  scope: scopeSchema,
  scopeId: z.string().min(1),
  thresholdConfig: z.record(z.string(), z.unknown()).optional(),
  destinationConfig: z.record(z.string(), z.unknown()).optional(),
  status: statusSchema.optional(),
});

const updateSchema = idAndOrg.extend({
  name: z.string().min(1).max(128).optional(),
  description: z.string().nullable().optional(),
  severity: severitySchema.optional(),
  ruleType: z.string().min(1).max(64).optional(),
  scope: scopeSchema.optional(),
  scopeId: z.string().min(1).optional(),
  thresholdConfig: z.record(z.string(), z.unknown()).optional(),
  destinationConfig: z.record(z.string(), z.unknown()).optional(),
  status: statusSchema.optional(),
});

/** The moments a rule carries, on the contract's own wire types. */
type AnomalyRuleMoments = Pick<AnomalyRule, "archivedAt" | "createdAt" | "updatedAt">;

type AnomalyRuleRow = Readonly<
  AnomalyRuleMoments & {
    id: string;
    organizationId: string;
    scope: string;
    scopeId: string;
    name: string;
    description: string | null;
    severity: string;
    ruleType: string;
    thresholdConfig: unknown;
    destinationConfig: unknown;
    status: string;
    createdById: string | null;
  }
>;

/**
 * The wire shape of one rule. Exported so the redaction it applies can be
 * tested without a router.
 */
export function toAnomalyRuleDto(row: AnomalyRuleRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    scope: row.scope,
    scopeId: row.scopeId,
    name: row.name,
    description: row.description,
    severity: row.severity,
    ruleType: row.ruleType,
    thresholdConfig: (row.thresholdConfig as Record<string, unknown>) ?? {},
    // The shared secret signs the customer's own SIEM alerts: a reader is told
    // one is set, never what it is. Writes still take the secret itself.
    destinationConfig: redactDestinationConfig(row.destinationConfig),
    status: row.status,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdById: row.createdById,
  };
}

function translateConfigValidationError(err: unknown, ruleType?: string): never {
  if (isZodLikeError(err)) {
    // Both threshold-config and destination-config validation produce
    // ZodError; the issue paths disambiguate — `destinations[*]` for the
    // dispatch schema, scalar field names for threshold.
    const isDestinationConfig = err.issues.some((issue) =>
      issue.path.some((part) => part === "destinations"),
    );
    const configName = isDestinationConfig ? "destinationConfig" : "thresholdConfig";
    const suffix = !isDestinationConfig && ruleType ? ` for ${ruleType}` : "";
    const complaint = `Invalid ${configName}${suffix}: ${err.issues
      .map((issue) => issue.message)
      .join("; ")}`;
    throw new ValidationError(complaint, { meta: { formErrors: [complaint] } });
  }
  throw err;
}

/** Installs the `anomalyRules.*` tRPC surface on a process root. */
export class AnomalyRulesTrpcApi {
  static create<
    TContext extends AnomalyRulesTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: AnomalyRulesTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy, planGate, validateOutput } = procedures;

    // The permission first, the plan gate second, exactly as the hand-built
    // chain composed them: a caller who may not read these at all is refused
    // before the answer names which plan the organization is on.
    const gated = (permission: AuthzPermission): TrpcPolicyDecorator => {
      const check = policy(permission);
      return (built) => check(planGate(built));
    };
    const VIEW_THEN_PLAN = "anomalyRules:view, then the plan gate carrying the ANOMALY_RULES copy";
    const MANAGE_THEN_PLAN =
      "anomalyRules:manage, then the plan gate carrying the ANOMALY_RULES copy";

    return createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .query("list", (p) =>
        p
          .withInput(organizationScope)
          .withOutput(anomalyRuleSchema.array())
          .withCustomPermission(gated("anomalyRules:view"), VIEW_THEN_PLAN)
          .handle(async ({ ctx, input }) =>
            (await ctx.app.governance.anomalyRuleList(input.organizationId)).map(toAnomalyRuleDto),
          ),
      )
      .query("get", (p) =>
        p
          .withInput(idAndOrg)
          .withOutput(anomalyRuleSchema)
          .withCustomPermission(gated("anomalyRules:view"), VIEW_THEN_PLAN)
          .handle(async ({ ctx, input }) =>
            toAnomalyRuleDto(
              await ctx.app.governance.anomalyRuleGetById({
                id: input.id,
                organizationId: input.organizationId,
              }),
            ),
          ),
      )
      .mutation("create", (p) =>
        p
          .withInput(createSchema)
          .withOutput(anomalyRuleSchema)
          .withCustomPermission(gated("anomalyRules:manage"), MANAGE_THEN_PLAN)
          .handle(async ({ ctx, input }) => {
            try {
              const created = await ctx.app.governance.anomalyRuleCreate({
                organizationId: input.organizationId,
                name: input.name,
                description: input.description ?? null,
                severity: input.severity,
                ruleType: input.ruleType,
                scope: input.scope,
                scopeId: input.scopeId,
                thresholdConfig: input.thresholdConfig,
                destinationConfig: input.destinationConfig,
                status: input.status,
                actorUserId: ctx.actor().id,
              });
              return toAnomalyRuleDto(created);
            } catch (err) {
              translateConfigValidationError(err, input.ruleType);
            }
          }),
      )
      .mutation("update", (p) =>
        p
          .withInput(updateSchema)
          .withOutput(anomalyRuleSchema)
          .withCustomPermission(gated("anomalyRules:manage"), MANAGE_THEN_PLAN)
          .handle(async ({ ctx, input }) => {
            try {
              const updated = await ctx.app.governance.anomalyRuleUpdate({
                id: input.id,
                organizationId: input.organizationId,
                name: input.name,
                description: input.description,
                severity: input.severity,
                ruleType: input.ruleType,
                scope: input.scope,
                scopeId: input.scopeId,
                thresholdConfig: input.thresholdConfig,
                destinationConfig: input.destinationConfig,
                status: input.status,
              });
              return toAnomalyRuleDto(updated);
            } catch (err) {
              translateConfigValidationError(err, input.ruleType);
            }
          }),
      )
      .mutation("archive", (p) =>
        p
          .withInput(idAndOrg)
          .withOutput(anomalyRuleSchema)
          .withCustomPermission(gated("anomalyRules:manage"), MANAGE_THEN_PLAN)
          .handle(async ({ ctx, input }) =>
            toAnomalyRuleDto(
              await ctx.app.governance.anomalyRuleArchive({
                id: input.id,
                organizationId: input.organizationId,
              }),
            ),
          ),
      )
      .build();
  }
}
