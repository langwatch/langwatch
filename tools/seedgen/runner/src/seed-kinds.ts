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
import { OrganizationApi } from "@langwatch/organization-contract";
import { ProjectApi } from "@langwatch/project-contract";
import {
  DEFAULT_PII_REDACTION_LEVEL,
  SPAN_MAX_PAST_MS,
  TraceApi,
  type OtlpTracesInput,
} from "@langwatch/trace-contract";
import { UserApi } from "@langwatch/user-contract";
import { z } from "zod";

import type { SeedAction, SeedReply } from "./protocol.ts";

/** The installed module operations the runner calls, and nothing else (plan §1, §3.1). */
export type SeedApis = Readonly<{
  authz: Pick<AuthzApi, "attachBindings">;
  dataRetention: Pick<DataRetentionApi, "setForScope">;
  trace: Pick<TraceApi, "otlpTraces">;
  log: Pick<LogApi, "collectOtlpLogs">;
  metric: Pick<MetricApi, "collectOtlpMetrics">;
  user: Pick<UserApi, "findByEmail" | "create" | "setFirstPassword">;
  organization: Pick<
    OrganizationApi,
    "getAllForUser" | "createAndAssign" | "createMembership" | "changeMemberRole" | "addTeamMember"
  >;
  project: Pick<ProjectApi, "listByTeam" | "create">;
}>;

/** What a run carries beside the Apis: the one dev password's hash every seeded login shares. */
export type SeedSettings = Readonly<{ passwordHash: string | null }>;

/** The Api tokens `SeedApis` is read from in the booted tasks App. */
export const seedApiTokens = {
  authz: AuthzApi,
  dataRetention: DataRetentionApi,
  trace: TraceApi,
  log: LogApi,
  metric: MetricApi,
  user: UserApi,
  organization: OrganizationApi,
  project: ProjectApi,
} as const;

type SeedRefs = Record<string, string>;
/**
 * `retry` names a refusal seedgen retries with back-off (a queue or store was not reachable);
 * `refused` one it does not.
 */
type SeedOutcome = { refs: SeedRefs } | { retry: string } | { refused: string };
type SeedKind = (input: {
  action: SeedAction;
  apis: SeedApis;
  settings: SeedSettings;
}) => Promise<SeedOutcome>;
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

const userCreateSchema = z.object({
  ref: z.string().min(1),
  input: z.object({ email: z.email(), state: z.enum(["accepted", "invited"]) }),
});
const orgCreateSchema = z.object({
  ref: z.string().startsWith("$org:"),
  as: z.string().min(1),
  input: z.object({ name: z.string().min(1), team: z.string().min(1) }),
});
const projectCreateSchema = z.object({
  ref: z.string().min(1),
  org: z.string().min(1),
  as: z.string().min(1),
  input: z.object({ name: z.string().min(1), team: z.string().min(1) }),
});
const memberAddSchema = z.object({
  org: z.string().min(1),
  as: z.string().min(1),
  input: z.object({
    user: z.string().min(1),
    role: z.enum(["ADMIN", "MEMBER", "EXTERNAL"]),
    team: z.string().min(1),
    teamRole: z.enum(["ADMIN", "MEMBER", "VIEWER"]),
  }),
});

/** The tiny Organization fields find-before-create reads. */
const noDemo = { isDemo: false, demoProjectUserId: "", demoProjectId: "" } as const;

const otlpRequestSchema = z.custom<OtlpTracesInput["traceRequest"]>(
  (value) => typeof value === "object" && value !== null && !Array.isArray(value),
);
const otlpExportSchema = inProject(z.record(z.string(), z.unknown()));

const DAY_MS = 24 * 60 * 60 * 1000;

/** A chunk older than the door's 31 days asks the trace owner's backfill reach (plan Q1 (a)). */
const backfillReachOf = (at: string | undefined): { backfillMaxPastDays?: number } => {
  if (!at) return {};
  const days = Math.ceil((Date.now() - Date.parse(at)) / DAY_MS) + 1;
  return days * DAY_MS > SPAN_MAX_PAST_MS ? { backfillMaxPastDays: days } : {};
};

const otlpOutcome = (result: { outcome: "collected" } | { outcome: "unavailable" }): SeedOutcome =>
  result.outcome === "unavailable" ? { retry: "otlp_unavailable" } : applied;

/**
 * Each kind seedgen may send, mapped to one installed `*Api` call. A grant with an `as` user is
 * bounded by what that user holds; only one with none is the tasks operator's `system` write.
 */
export const SEED_KINDS: Readonly<Record<string, SeedKind>> = {
  /** Finds the account by email, else mints it; an accepted user gets the shared dev password. */
  "user.create": async ({ action, apis, settings }) => {
    const { ref, input } = userCreateSchema.parse(action);
    const user =
      (await apis.user.findByEmail({ email: input.email })) ??
      (await apis.user.create({
        name: input.email.split("@")[0] ?? input.email,
        email: input.email,
      }));
    if (settings.passwordHash && input.state === "accepted") {
      await apis.user.setFirstPassword({ id: user.id, passwordHash: settings.passwordHash });
    }
    return { refs: { [ref]: user.id } };
  },
  /** The owner founds the org and its main team, unless it already founded one so named. */
  "org.create": async ({ action, apis }) => {
    const { ref, as, input } = orgCreateSchema.parse(action);
    const teamRef = `$team:${ref.slice("$org:".length)}/${input.team}`;
    const found = (await apis.organization.getAllForUser(noDemo, { id: as })).find(
      (organization) => organization.name === input.name,
    );
    const team = found?.teams.find((candidate) => !candidate.isPersonal) ?? found?.teams[0];
    if (found && team) return { refs: { [ref]: found.id, [teamRef]: team.id } };
    const created = await apis.organization.createAndAssign({ orgName: input.name }, { id: as });
    return { refs: { [ref]: created.organization.id, [teamRef]: created.team.id } };
  },
  "project.create": async ({ action, apis }) => {
    const { ref, org, as, input } = projectCreateSchema.parse(action);
    const existing = (
      await apis.project.listByTeam({ organizationId: org, teamId: input.team })
    ).find((project) => project.name === input.name);
    const project =
      existing ??
      (await apis.project.create(
        {
          organizationId: org,
          teamId: input.team,
          name: input.name,
          language: "other",
          framework: "other",
        },
        { id: as },
      ));
    return { refs: { [ref]: project.id } };
  },
  /**
   * Admits a user as the owner would: a membership row with the owner's admission (a grant alone
   * makes no member), then the row's role, then the main team. A seat the plan cannot spare is
   * refused, so the counts never claim a member who waits.
   */
  "member.add": async ({ action, apis }) => {
    const { org, as, input } = memberAddSchema.parse(action);
    const actor = { type: "user" as const, id: as };
    const admission = await apis.organization.createMembership({
      organizationId: org,
      userId: input.user,
      seat: "MEMBER",
      admittedBy: { actor, commandId: action.id },
    });
    if (admission.pending) return { refused: "seat_unavailable" };
    if (input.role !== admission.seat) {
      await apis.organization.changeMemberRole(
        { organizationId: org, userId: input.user, role: input.role },
        { id: as },
      );
    }
    await apis.organization.addTeamMember({
      organizationId: org,
      teamId: input.team,
      userId: input.user,
      role: input.teamRole,
      actor,
      caller: actor,
    });
    return applied;
  },
  "grant.attach": async ({ action, apis }) => {
    const { org, ref, input } = grantAttachSchema.parse(action);
    const grants = input.grants.map((grant) => ({ ...grant, bindingId: newAuthzGrantId() }));
    const outcome = await apis.authz.attachBindings({
      organizationId: org,
      bindings: grants,
      ...(action.as
        ? { caller: { type: "user", id: action.as }, actor: { type: "user", id: action.as } }
        : { caller: { type: "system" }, actor: { type: "system", id: null } }),
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
    const result = await apis.trace.otlpTraces({
      tenantId: project,
      traceRequest,
      ...backfillReachOf(action.at),
    });
    if ((result.ingestionFailures ?? 0) > 0) return { retry: "otlp_ingestion_failed" };
    // A dropped span never landed: refusing keeps the printed counts to what exists.
    return (result.rejectedSpans ?? 0) > 0 ? { refused: "otlp_spans_rejected" } : applied;
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
  settings = { passwordHash: null },
}: {
  action: SeedAction;
  apis: SeedApis;
  settings?: SeedSettings;
}): Promise<SeedReply> {
  const kind = SEED_KINDS[action.kind];
  if (!kind) return refusal({ action, code: "unknown_seed_kind", retryable: false });
  try {
    const outcome = await kind({ action, apis, settings });
    if ("retry" in outcome) return refusal({ action, code: outcome.retry, retryable: true });
    if ("refused" in outcome) return refusal({ action, code: outcome.refused, retryable: false });
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
