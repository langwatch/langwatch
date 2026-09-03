/**
 * AnomalyRule admin CRUD tRPC surface.
 *
 * Reads on `anomalyRules:view`, writes on `anomalyRules:manage`. Every
 * declaration is wrapped by an enterprise plan gate so a non-enterprise
 * caller reads the `ANOMALY_RULES` refusal — MEMBER / EXTERNAL never see
 * the surface, and even ADMIN sees it only on plan. The eval engine plus
 * alert dispatch is Option C: this router ships the configuration entity
 * only, so the admin UI persists real rules instead of MOCK_RULES.
 *
 * `translateConfigValidationError` promotes threshold-config / destination-
 * config Zod failures into a `ValidationError` carrying a human sentence in
 * `meta.formErrors`. The service-side schemas produce ZodError, the tRPC
 * error formatter converts it to `ValidationError.fromZodError`, and
 * fromZodError files each issue under `meta.fieldErrors` keyed by the
 * offending property — the registry then has nothing to name and the admin
 * reads "Some of the values aren't valid." with no detail. Composing the
 * complaint here lets `validation_error` render it verbatim.
 *
 * Transport only: input parsing, delegation, wire shape, DTO mapping.
 *
 * Spec: specs/ai-gateway/governance/anomaly-rules.feature
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  ANOMALY_RULE_SCOPES,
  ANOMALY_RULE_SEVERITIES,
  type GovernanceService,
} from "@langwatch/enterprise-governance-contract";
import { isZodLikeError, ValidationError } from "@langwatch/handled-error";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";

export type AnomalyRulesTrpcContext = Readonly<{
  app: Readonly<{ governance: GovernanceService }>;
  actor(): Readonly<{ id: string }>;
}>;

type ProcedureDecorator = <TProcedure>(procedure: TProcedure) => TProcedure;

type AnomalyRulesTrpcProcedures<
  TContext extends AnomalyRulesTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  policy(permission: AuthzPermission): ProcedureDecorator;
  /** Refuses off-plan callers with the `ANOMALY_RULES` refusal copy. */
  planGate: ProcedureDecorator;
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

type AnomalyRuleRow = Readonly<{
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
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string | null;
}>;

function toDto(row: AnomalyRuleRow) {
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
    destinationConfig: (row.destinationConfig as Record<string, unknown>) ?? {},
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
    const { protected: procedure, policy, planGate } = procedures;

    const view = <TSchema extends z.ZodTypeAny>(schema: TSchema) =>
      policy("anomalyRules:view")(planGate(procedure.input(schema)));
    const manage = <TSchema extends z.ZodTypeAny>(schema: TSchema) =>
      policy("anomalyRules:manage")(planGate(procedure.input(schema)));

    return trpc.router({
      list: view(organizationScope).query(async ({ ctx, input }) =>
        (await ctx.app.governance.anomalyRuleList(input.organizationId)).map(toDto),
      ),

      get: view(idAndOrg).query(async ({ ctx, input }) =>
        toDto(
          await ctx.app.governance.anomalyRuleGetById({
            id: input.id,
            organizationId: input.organizationId,
          }),
        ),
      ),

      create: manage(createSchema).mutation(async ({ ctx, input }) => {
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
          return toDto(created);
        } catch (err) {
          translateConfigValidationError(err, input.ruleType);
        }
      }),

      update: manage(updateSchema).mutation(async ({ ctx, input }) => {
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
          return toDto(updated);
        } catch (err) {
          translateConfigValidationError(err, input.ruleType);
        }
      }),

      archive: manage(idAndOrg).mutation(async ({ ctx, input }) =>
        toDto(
          await ctx.app.governance.anomalyRuleArchive({
            id: input.id,
            organizationId: input.organizationId,
          }),
        ),
      ),
    });
  }
}
