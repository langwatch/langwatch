import {
  AuthzApi,
  authzLedgerBindingAttachSchema,
  newAuthzGrantId,
} from "@langwatch/authz-contract";
import {
  DataRetentionApi,
  retentionCategorySchema,
  scopeAssignmentSchema,
} from "@langwatch/data-retention-contract";
import { HandledError } from "@langwatch/handled-error";
import { LogApi } from "@langwatch/log-contract";
import { MetricApi } from "@langwatch/metric-contract";
import {
  DEFAULT_PII_REDACTION_LEVEL,
  TraceApi,
  type OtlpTracesInput,
} from "@langwatch/trace-contract";
import { z } from "zod";

import type { SeedAction, SeedReply } from "./protocol.ts";

/** The installed module operations the runner calls, and nothing else (plan §1, §3.1). */
export type SeedApis = Readonly<{
  authz: Pick<AuthzApi, "attachBindings">;
  dataRetention: Pick<DataRetentionApi, "setForScope">;
  trace: Pick<TraceApi, "otlpTraces">;
  log: Pick<LogApi, "collectOtlpLogs">;
  metric: Pick<MetricApi, "collectOtlpMetrics">;
}>;

/** The Api tokens `SeedApis` is read from in the booted tasks App. */
export const seedApiTokens = {
  authz: AuthzApi,
  dataRetention: DataRetentionApi,
  trace: TraceApi,
  log: LogApi,
  metric: MetricApi,
} as const;

type SeedRefs = Record<string, string>;
/** `retry` names a refusal seedgen retries with back-off: a queue or store was not reachable. */
type SeedOutcome = { refs: SeedRefs } | { retry: string };
type SeedKind = (input: { action: SeedAction; apis: SeedApis }) => Promise<SeedOutcome>;
const applied: SeedOutcome = { refs: {} };

const inOrganization = <Input extends z.ZodType>(input: Input) =>
  z.object({ org: z.string().min(1), ref: z.string().min(1).optional(), input });
const inProject = <Input extends z.ZodType>(input: Input) =>
  z.object({ org: z.string().min(1), project: z.string().min(1), input });

const grantSchema = authzLedgerBindingAttachSchema
  .pick({ principal: true, role: true, scopeType: true, scopeId: true, expiresAtMs: true })
  .safeExtend({ customRoleId: z.string().min(1).nullable().default(null) });
const grantAttachSchema = inOrganization(z.object({ grants: z.array(grantSchema).min(1) }));

/** Without a scope it is the organization's; without a category it is every category. */
const retentionSetSchema = inOrganization(
  z.object({
    days: z.number().int().positive(),
    scope: scopeAssignmentSchema.optional(),
    category: retentionCategorySchema.optional(),
  }),
);

const otlpRequestSchema = z.custom<OtlpTracesInput["traceRequest"]>(
  (value) => typeof value === "object" && value !== null && !Array.isArray(value),
);
const otlpExportSchema = inProject(z.record(z.string(), z.unknown()));

const otlpOutcome = (result: { outcome: "collected" } | { outcome: "unavailable" }): SeedOutcome =>
  result.outcome === "unavailable" ? { retry: "otlp_unavailable" } : applied;

/**
 * Each kind seedgen may send, mapped to one installed `*Api` call. Grants are attached as the
 * `system` caller: the tasks process holds the operator's authority (ARCHITECTURE §4, Tasks).
 */
export const SEED_KINDS: Readonly<Record<string, SeedKind>> = {
  "grant.attach": async ({ action, apis }) => {
    const { org, ref, input } = grantAttachSchema.parse(action);
    const grants = input.grants.map((grant) => ({ ...grant, bindingId: newAuthzGrantId() }));
    const outcome = await apis.authz.attachBindings({
      organizationId: org,
      bindings: grants,
      caller: { type: "system" },
      actor: { type: "system", id: null },
      onDuplicate: "skip",
      awaitProjection: true,
    });
    if (!ref) return applied;
    const attached = new Set(outcome.attached);
    const nameOf = (index: number) => (grants.length === 1 ? ref : `${ref}/${index}`);
    const refs = grants.flatMap((grant, index) =>
      attached.has(grant.bindingId) ? [[nameOf(index), grant.bindingId] as const] : [],
    );
    return { refs: Object.fromEntries(refs) };
  },
  "retention.set": async ({ action, apis }) => {
    const { org, input } = retentionSetSchema.parse(action);
    const scope = input.scope ?? { scopeType: "ORGANIZATION" as const, scopeId: org };
    const categories = input.category ? [input.category] : retentionCategorySchema.options;
    for (const category of categories) {
      await apis.dataRetention.setForScope({
        organizationId: org,
        scope,
        category,
        retentionDays: input.days,
      });
    }
    return applied;
  },
  "trace.otlp": async ({ action, apis }) => {
    const { project } = otlpExportSchema.parse(action);
    const traceRequest = otlpRequestSchema.parse(action.input);
    const result = await apis.trace.otlpTraces({ tenantId: project, traceRequest });
    return (result.ingestionFailures ?? 0) > 0 ? { retry: "otlp_ingestion_failed" } : applied;
  },
  "log.otlp": async ({ action, apis }) => {
    const { org, project, input } = otlpExportSchema.parse(action);
    return otlpOutcome(
      await apis.log.collectOtlpLogs({
        tenantId: project,
        organizationId: org,
        logRequest: input,
        piiRedactionLevel: DEFAULT_PII_REDACTION_LEVEL,
      }),
    );
  },
  "metric.otlp": async ({ action, apis }) => {
    const { org, project, input } = otlpExportSchema.parse(action);
    return otlpOutcome(
      await apis.metric.collectOtlpMetrics({
        tenantId: project,
        organizationId: org,
        metricRequest: input,
        piiRedactionLevel: DEFAULT_PII_REDACTION_LEVEL,
      }),
    );
  },
};

const refusal = ({
  action,
  code,
  retryable,
}: {
  action: SeedAction;
  code: string;
  retryable: boolean;
}): SeedReply => ({ id: action.id, ok: false, code, ...(retryable ? { retryable } : {}) });

/**
 * Applies one action; a product refusal becomes a refusal line, anything else is thrown. Empty
 * refs and a false `retryable` are left out, as Go's `omitempty` does.
 */
export async function applySeedAction({
  action,
  apis,
}: {
  action: SeedAction;
  apis: SeedApis;
}): Promise<SeedReply> {
  const kind = SEED_KINDS[action.kind];
  if (!kind) return refusal({ action, code: "unknown_seed_kind", retryable: false });
  try {
    const outcome = await kind({ action, apis });
    if ("retry" in outcome) return refusal({ action, code: outcome.retry, retryable: true });
    const minted = Object.keys(outcome.refs).length > 0;
    return { id: action.id, ok: true, ...(minted ? { refs: outcome.refs } : {}) };
  } catch (error) {
    if (error instanceof HandledError) {
      return refusal({ action, code: error.code, retryable: error.retryable });
    }
    if (error instanceof z.ZodError) {
      return refusal({ action, code: "malformed_seed_action", retryable: false });
    }
    throw error;
  }
}
