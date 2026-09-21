/**
 * The report one install sends, built from the dictionary (ADR-141, section
 * 10).
 *
 * The dictionary says what may be in a report; this says what is in this one.
 * Nothing reaches the payload that the dictionary does not name, which is
 * checked rather than trusted: `usageReportKeys` is the list the docs page
 * publishes, and a suite compares the two.
 *
 * The optional block is switchable as a whole, and `hostname` on its own.
 * Switching the optional block off leaves a report that still says which
 * release is running and how many projects it carries, which is what a support
 * conversation needs, and says nothing about what anyone does with it.
 */

import { licenseConnectServices } from "@ee/licensing/connect/install/connectEntitlement";
import { env } from "~/env.mjs";
import type { PrismaClient } from "~/generated/prisma/client";
import type {
  InstanceUsageCountsInput,
  InstanceUsageStatsRepository,
} from "~/server/app-layer/usage-stats/repositories/instance-usage.clickhouse.repository";
import {
  activityCounts,
  onboardingLadder,
  storedCounts,
  userEmailDomains,
  windowStarts,
} from "./counts";
import {
  USAGE_FIELDS,
  USAGE_REPORT_SCHEMA_VERSION,
  type UsageFieldCategory,
} from "./dictionary";

/** What a customer switched off, read by the caller and passed in. */
export interface UsageReportSwitches {
  /** The optional category as a whole. On unless someone switched it off. */
  readonly optional: boolean;
  /** Hostname, which names the customer's own network. */
  readonly hostname: boolean;
}

export const USAGE_REPORT_SWITCHES_ON: UsageReportSwitches = {
  optional: true,
  hostname: true,
};

export interface UsageReportInput {
  readonly prisma: PrismaClient;
  readonly organizationIds: string[];
  readonly instanceId: string;
  readonly firstSeenAt: Date | null;
  readonly repository: InstanceUsageStatsRepository;
  readonly switches?: UsageReportSwitches;
  readonly now?: Date;
}

/** Every key the dictionary names, which is every key a report may carry. */
export function usageReportKeys(): string[] {
  return USAGE_FIELDS.map((field) => field.key);
}

/** The keys of one category, for the page that lists them. */
export function usageReportKeysOfCategory(
  category: UsageFieldCategory,
): string[] {
  return USAGE_FIELDS.filter((field) => field.category === category).map(
    (field) => field.key,
  );
}

/** What the install's own deployment says about itself. */
function standardBlock({
  instanceId,
  firstSeenAt,
  now,
}: {
  instanceId: string;
  firstSeenAt: Date | null;
  now: Date;
}): Record<string, unknown> {
  return {
    instance_id: instanceId,
    report_schema_version: USAGE_REPORT_SCHEMA_VERSION,
    version: process.env.SERVICE_VERSION ?? "unknown",
    install_method: process.env.INSTALL_METHOD ?? "self-hosted",
    chart_version: process.env.LANGWATCH_CHART_VERSION ?? null,
    environment: process.env.NODE_ENV ?? "unknown",
    first_seen_at: firstSeenAt?.toISOString() ?? null,
    timestamp: now.toISOString(),
  };
}

/** What is needed to run the service for this customer. */
async function operationalBlock({
  prisma,
  organizationIds,
  projectIds,
}: {
  prisma: PrismaClient;
  organizationIds: string[];
  projectIds: string[];
}): Promise<Record<string, unknown>> {
  const [teams, users, organizations] = await Promise.all([
    prisma.team.count({ where: { organizationId: { in: organizationIds } } }),
    prisma.organizationUser.count({
      where: { organizationId: { in: organizationIds } },
    }),
    prisma.organization.findMany({
      where: { id: { in: organizationIds } },
      select: { license: true, ssoProvider: true },
    }),
  ]);

  const connected = organizations.some(
    (organization) =>
      licenseConnectServices({ licenseKey: organization.license }).length > 0,
  );

  return {
    organizations: organizationIds.length,
    teams,
    projects: projectIds.length,
    users,
    auth_method: process.env.AUTH_PROVIDER ?? "email",
    // The name of the provider in use, never its configuration. The first one
    // named, because an install with two is still an install using SSO.
    sso_provider:
      organizations.find((organization) => organization.ssoProvider)
        ?.ssoProvider ?? null,
    connected,
  };
}

/** Everything a customer may switch off, and the default for a new field. */
async function optionalBlock({
  prisma,
  organizationIds,
  projectIds,
  repository,
  switches,
  now,
}: {
  prisma: PrismaClient;
  organizationIds: string[];
  projectIds: string[];
  repository: InstanceUsageStatsRepository;
  switches: UsageReportSwitches;
  now: Date;
}): Promise<Record<string, unknown>> {
  // An install with an organization and no project yet has nothing scoped to
  // a project to count, and the tenancy guard refuses an empty project list
  // rather than answering zero. Those figures are left out, which the
  // receiver reads as absent; the organization's own fields still go.
  const projectScoped = <T extends Record<string, unknown>>(
    read: () => Promise<T>,
  ): Promise<T | Record<string, never>> =>
    projectIds.length > 0 ? read() : Promise.resolve({});

  const [stored, ladder, domains, activity, ingested, providers] =
    await Promise.all([
      projectScoped(() =>
        storedCounts({ prisma, projectIds, organizationIds, now }),
      ),
      projectScoped(() =>
        onboardingLadder({ prisma, projectIds, organizationIds }),
      ),
      userEmailDomains(prisma),
      projectScoped(() => activityCounts({ prisma, projectIds, now })),
      ingestedCounts({ organizationIds, projectIds, repository, now }),
      // Model providers are scoped to the organization, not the project: one
      // row is shared by every project a scope names. Read one organization
      // at a time, which is the shape the tenancy guard on that model admits.
      Promise.all(
        organizationIds.map((organizationId) =>
          prisma.modelProvider.findMany({
            where: { organizationId },
            select: { provider: true },
            distinct: ["provider"],
          }),
        ),
      ).then((perOrganization) => perOrganization.flat()),
    ]);

  return {
    ...stored,
    ...ladder,
    ...activity,
    ...ingested,
    user_email_domains: domains,
    ...(switches.hostname ? { hostname: process.env.BASE_HOST ?? null } : {}),
    // Names only. A key, an endpoint and a deployment name are all things this
    // report has no business carrying.
    model_providers: [...new Set(providers.map((row) => row.provider))].sort(),
    storage_backend: process.env.S3_ENDPOINT ? "s3" : "local",
    email_configured: Boolean(process.env.EMAIL_PROVIDER),
    gateway_configured: Boolean(env.LW_GATEWAY_BASE_URL),
  };
}

/**
 * What ClickHouse holds.
 *
 * Asked per organization, because the ClickHouse client is resolved per
 * organization, and added up, because the report describes the install. Each
 * figure is taken lifetime and over both windows, and each rung of the ladder
 * that lives in ClickHouse is the earliest any organization reached it.
 */
async function ingestedCounts({
  organizationIds,
  projectIds,
  repository,
  now,
}: {
  organizationIds: string[];
  projectIds: string[];
  repository: InstanceUsageStatsRepository;
  now: Date;
}): Promise<Record<string, number | string | null>> {
  const install = acrossOrganizations({ organizationIds, projectIds, now });

  const [
    traces,
    scenarioRuns,
    spans,
    gateway,
    instantEvalRuns,
    instantEvalJudgments,
    codingAgentSessions,
    firstGatewayRequest,
    firstInstantEvalRun,
    firstCodingAgentSession,
  ] = await Promise.all([
    install.windowed(
      "traces",
      (input) => repository.findTraceCount(input),
      "totalTraces",
    ),
    install.windowed(
      "scenario_runs",
      (input) => repository.findScenarioRunCount(input),
      "totalScenarioEvents",
    ),
    install.windowed("spans", (input) => repository.findSpanCount(input)),
    gatewayCounts({ install, repository }),
    install.windowed("instant_eval_runs", (input) =>
      repository.findInstantEvalRunCount(input),
    ),
    install.windowed("instant_eval_judgments", (input) =>
      repository.findInstantEvalJudgmentCount(input),
    ),
    install.windowed("coding_agent_sessions", (input) =>
      repository.findCodingAgentSessionCount(input),
    ),
    install.earliest((input) => repository.findFirstGatewayRequestAt(input)),
    install.earliest((input) => repository.findFirstInstantEvalRunAt(input)),
    install.earliest((input) =>
      repository.findFirstCodingAgentSessionAt(input),
    ),
  ]);

  return {
    ...traces,
    ...scenarioRuns,
    ...spans,
    ...gateway,
    ...instantEvalRuns,
    ...instantEvalJudgments,
    ...codingAgentSessions,
    first_gateway_request_at: firstGatewayRequest,
    first_instant_eval_run_at: firstInstantEvalRun,
    first_coding_agent_session_at: firstCodingAgentSession,
  };
}

/** The gateway ledger answers requests and spend in one read per stretch. */
async function gatewayCounts({
  install,
  repository,
}: {
  install: ReturnType<typeof acrossOrganizations>;
  repository: InstanceUsageStatsRepository;
}): Promise<Record<string, number>> {
  const read = (input: InstanceUsageCountsInput) =>
    repository.findGatewaySpend(input);
  const [lifetime, sevenDays, twentyEight] = await Promise.all([
    install.read(read),
    install.read(read, "sevenDays"),
    install.read(read, "twentyEight"),
  ]);

  const requests = (spend: { requests: number }[]) =>
    sum(spend.map((row) => row.requests));
  const usd = (spend: { spendUsd: number }[]) =>
    sum(spend.map((row) => row.spendUsd));

  return {
    gateway_requests: requests(lifetime),
    gateway_requests_7d: requests(sevenDays),
    gateway_requests_28d: requests(twentyEight),
    gateway_spend_usd: usd(lifetime),
    gateway_spend_usd_7d: usd(sevenDays),
    gateway_spend_usd_28d: usd(twentyEight),
  };
}

function sum(counts: number[]): number {
  return counts.reduce((a, b) => a + b, 0);
}

/**
 * The install's organizations, read one at a time and folded into one figure.
 *
 * `read` asks every organization for one stretch of time; `windowed` asks the
 * three stretches and adds them up under the dictionary keys; `earliest` is a
 * rung of the ladder, the first day any organization reached it.
 */
function acrossOrganizations({
  organizationIds,
  projectIds,
  now,
}: {
  organizationIds: string[];
  projectIds: string[];
  now: Date;
}) {
  const windows = windowStarts(now);

  const read = <T>(
    reader: (input: InstanceUsageCountsInput) => Promise<T>,
    window?: keyof typeof windows,
  ): Promise<T[]> =>
    Promise.all(
      organizationIds.map((organizationId) =>
        reader({
          organizationId,
          projectIds,
          ...(window ? { since: windows[window] } : {}),
        }),
      ),
    );

  const windowed = async (
    key: string,
    reader: (input: InstanceUsageCountsInput) => Promise<number>,
    lifetimeKey?: string,
  ): Promise<Record<string, number>> => {
    const [lifetime, sevenDays, twentyEight] = await Promise.all([
      read(reader),
      read(reader, "sevenDays"),
      read(reader, "twentyEight"),
    ]);
    return {
      [lifetimeKey ?? key]: sum(lifetime),
      [`${key}_7d`]: sum(sevenDays),
      [`${key}_28d`]: sum(twentyEight),
    };
  };

  const earliest = async (
    reader: (input: InstanceUsageCountsInput) => Promise<Date | null>,
  ): Promise<string | null> => {
    const reached = (await read(reader)).filter(
      (date): date is Date => date !== null,
    );
    if (reached.length === 0) return null;
    return new Date(
      Math.min(...reached.map((date) => date.getTime())),
    ).toISOString();
  };

  return { read, windowed, earliest };
}

/** The report this install would send right now. */
export async function collectUsageReport({
  prisma,
  organizationIds,
  instanceId,
  firstSeenAt,
  repository,
  switches = USAGE_REPORT_SWITCHES_ON,
  now = new Date(),
}: UsageReportInput): Promise<Record<string, unknown>> {
  if (organizationIds.length === 0) {
    throw new Error("an install with no organization has nothing to report");
  }

  const projects = await prisma.project.findMany({
    where: { team: { organizationId: { in: organizationIds } } },
    select: { id: true },
  });
  const projectIds = projects.map((project) => project.id);

  const [operational, optional] = await Promise.all([
    operationalBlock({ prisma, organizationIds, projectIds }),
    switches.optional
      ? optionalBlock({
          prisma,
          organizationIds,
          projectIds,
          repository,
          switches,
          now,
        })
      : Promise.resolve({}),
  ]);

  return {
    ...standardBlock({ instanceId, firstSeenAt, now }),
    ...operational,
    ...optional,
  };
}
