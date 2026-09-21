/**
 * The report one install sends, built from the dictionary (ADR-139, section
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
import type { InstanceUsageStatsRepository } from "~/server/app-layer/usage-stats/repositories/instance-usage.clickhouse.repository";
import {
  activityCounts,
  onboardingLadder,
  storedCounts,
  userEmailDomains,
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
  const [stored, ladder, domains, activity, ingested, providers] =
    await Promise.all([
      storedCounts({ prisma, projectIds, now }),
      onboardingLadder({ prisma, projectIds }),
      userEmailDomains(prisma),
      activityCounts({ prisma, projectIds, now }),
      ingestedCounts({ organizationIds, projectIds, repository }),
      prisma.modelProvider.findMany({
        where: { projectId: { in: projectIds } },
        select: { provider: true },
        distinct: ["provider"],
      }),
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
    model_providers: providers.map((row) => row.provider).sort(),
    storage_backend: process.env.S3_ENDPOINT ? "s3" : "local",
    email_configured: Boolean(process.env.EMAIL_PROVIDER),
    gateway_configured: Boolean(env.LW_GATEWAY_BASE_URL),
  };
}

/**
 * What ClickHouse holds.
 *
 * Asked per organization, because its tenant column is the organization and a
 * query spanning tenants has no partition to prune.
 */
async function ingestedCounts({
  organizationIds,
  projectIds,
  repository,
}: {
  organizationIds: string[];
  projectIds: string[];
  repository: InstanceUsageStatsRepository;
}): Promise<Record<string, number>> {
  const sum = (counts: number[]) => counts.reduce((a, b) => a + b, 0);
  const [traces, scenarioRuns] = await Promise.all([
    Promise.all(
      organizationIds.map((organizationId) =>
        repository.findTraceCount({ organizationId, projectIds }),
      ),
    ),
    Promise.all(
      organizationIds.map((organizationId) =>
        repository.findScenarioRunCount({ organizationId, projectIds }),
      ),
    ),
  ]);

  return {
    totalTraces: sum(traces),
    totalScenarioEvents: sum(scenarioRuns),
  };
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
