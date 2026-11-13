import { StaffAccessAuditUnavailableError } from "@langwatch/api";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { CodingAgentApi } from "@langwatch/coding-agent-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { generate } from "@langwatch/ksuid";
import type { OpsApi } from "@langwatch/ops-contract";
import type {
  OrganizationApi,
  OrganizationProvisioningSummary,
} from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import {
  StaffAccessNotFoundError,
  type StaffAccessDoorSession,
  type StaffAccessOrganizationList,
  type StaffAccessQueueSummary,
  type StaffAccessUsage,
} from "@langwatch/staff-access-contract";
import { fromDate, type Instant, Temporal } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";

import type { StaffAccessEventRepository } from "../repositories/staff-access.repository.ts";
import { isoText, STAFF_ACCESS_USAGE_CLASSIFICATION } from "../rules/staff-access.rules.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const ORGANIZATIONS_LISTED = 50;

type OpsReadDeps = Readonly<{
  events: StaffAccessEventRepository;
  ops: Pick<OpsApi, "listQueues">;
  organizations: Pick<
    OrganizationApi,
    "findProvisioningSummary" | "listProvisioningSummaries" | "getAllMembers"
  >;
  projects: Pick<ProjectApi, "listIdsByOrganization">;
  codingAgents: Pick<CodingAgentApi, "countUsage">;
  gateway: Pick<GatewayApi, "countUsage">;
  traces: Pick<TraceApi, "countUsage">;
  apiKeys: Pick<ApiKeyApi, "listAll">;
  auth: Pick<AuthApi, "countUsageForMembers">;
  now: () => Instant;
}>;

type OpsSession = Extract<StaffAccessDoorSession, { kind: "ops" }>;

/**
 * The `ops:read` allowlist an ops token reaches: organizations, one organization's usage, and the
 * queue summary. Each call writes its trail row before it reads and finishes it after.
 */
export class StaffAccessOpsReadService {
  private constructor(private readonly deps: OpsReadDeps) {}

  static create(deps: OpsReadDeps): StaffAccessOpsReadService {
    return new StaffAccessOpsReadService(deps);
  }

  listOrganizations({
    session,
    query,
  }: {
    session: StaffAccessDoorSession;
    query?: string;
  }): Promise<StaffAccessOrganizationList> {
    return this.traced({
      session,
      operation: "staffAccess.listOrganizations",
      path: "/api/staff-access/ops/organizations",
      read: async () => {
        const needle = query?.trim().toLowerCase() ?? "";
        const all = await this.deps.organizations.listProvisioningSummaries();
        const organizations = all
          .filter(
            (summary) =>
              needle === "" ||
              summary.id.toLowerCase() === needle ||
              summary.slug.toLowerCase().includes(needle) ||
              summary.name.toLowerCase().includes(needle),
          )
          .slice(0, ORGANIZATIONS_LISTED)
          .map(({ id, slug, name }) => ({ id, slug, name }));
        return { organizations };
      },
    });
  }

  getOrganizationUsage({
    session,
    organization,
  }: {
    session: StaffAccessDoorSession;
    organization: string;
  }): Promise<StaffAccessUsage> {
    return this.traced({
      session,
      operation: "staffAccess.getOrganizationUsage",
      path: `/api/staff-access/ops/organizations/${organization}/usage`,
      organization,
      read: async ({ summary }) => {
        const found = summary as OrganizationProvisioningSummary;
        const at = this.deps.now();
        const since7 = at.epochMilliseconds - 7 * DAY_MS;
        const since30 = at.epochMilliseconds - 30 * DAY_MS;
        const [projectIds, members, keys] = await Promise.all([
          this.deps.projects.listIdsByOrganization({ organizationId: found.id }),
          this.deps.organizations.getAllMembers({ organizationId: found.id }),
          this.deps.apiKeys.listAll({ organizationId: found.id }),
        ]);
        const [agents7, agents30, gateway, traces, signedIn] = await Promise.all([
          this.deps.codingAgents.countUsage({ projectIds, since: since7 }),
          this.deps.codingAgents.countUsage({ projectIds, since: since30 }),
          this.deps.gateway.countUsage({ projectIds, since: since30 }),
          this.deps.traces.countUsage({ projectIds, since: since30 }),
          this.deps.auth.countUsageForMembers({
            memberUserIds: members.map((member) => member.id),
            at: at.epochMilliseconds,
          }),
        ]);
        return {
          organization: { id: found.id, slug: found.slug, name: found.name },
          at: isoText(at),
          codingAgentSessions: {
            last7Days: agents7.sessions,
            last30Days: agents30.sessions,
            lastSessionAt:
              agents30.lastSessionAt === undefined
                ? null
                : isoText(Temporal.Instant.fromEpochMilliseconds(agents30.lastSessionAt)),
          },
          gateway: { requests30Days: gateway.requests, spendUsd30Days: gateway.spendUsd },
          traces30Days: traces.traces,
          apiKeys: keys
            .filter((key) => key.revokedAt === null)
            .map((key) => ({
              id: key.id,
              name: key.name,
              lastUsedAt: key.lastUsedAt ? isoText(fromDate(key.lastUsedAt)) : null,
            })),
          membersSignedIn: signedIn.signedInUsers,
          classification: STAFF_ACCESS_USAGE_CLASSIFICATION,
        };
      },
    });
  }

  getQueueSummary({
    session,
  }: {
    session: StaffAccessDoorSession;
  }): Promise<StaffAccessQueueSummary> {
    return this.traced({
      session,
      operation: "staffAccess.getQueueSummary",
      path: "/api/staff-access/ops/queues",
      read: async () => {
        const queues = await this.deps.ops.listQueues();
        return {
          queues: queues.map((queue) => ({
            name: queue.name,
            displayName: queue.displayName,
            pendingGroupCount: queue.pendingGroupCount,
            blockedGroupCount: queue.blockedGroupCount,
            activeGroupCount: queue.activeGroupCount,
            parkedGroupCount: queue.parkedGroupCount,
            totalPendingJobs: queue.totalPendingJobs,
            dlqCount: queue.dlqCount,
          })),
        };
      },
    });
  }

  /** Writes the trail row, runs the read, then records how it ended. */
  private async traced<Answer>({
    session,
    operation,
    path,
    organization,
    read,
  }: {
    session: StaffAccessDoorSession;
    operation: string;
    path: string;
    organization?: string;
    read: (input: { summary: OrganizationProvisioningSummary | undefined }) => Promise<Answer>;
  }): Promise<Answer> {
    const ops = opsSessionOf(session);
    const summary = organization === undefined ? undefined : await this.resolve({ organization });
    const id = generate("staffevent").toString();
    const startedAt = this.deps.now();
    try {
      await this.deps.events.create({
        id,
        requestId: ops.requestId,
        at: startedAt,
        method: "GET",
        path,
        operation,
        permissions: ["opsRead:view"],
        organizationId: summary?.id ?? null,
        projectId: null,
        status: null,
        errorCode: null,
        durationMs: null,
        ipAddress: ops.ipAddress,
        userAgent: ops.userAgent,
      });
    } catch {
      throw new StaffAccessAuditUnavailableError();
    }
    const finish = (status: number, errorCode: string | null) =>
      this.deps.events
        .finish({
          id,
          status,
          errorCode,
          durationMs: this.deps.now().epochMilliseconds - startedAt.epochMilliseconds,
        })
        .catch(() => undefined);
    try {
      const answer = await read({ summary });
      await finish(200, null);
      return answer;
    } catch (error) {
      await finish(500, null);
      throw error;
    }
  }

  private async resolve({
    organization,
  }: {
    organization: string;
  }): Promise<OrganizationProvisioningSummary> {
    const byId = await this.deps.organizations.findProvisioningSummary(organization);
    if (byId) return byId;
    const all = await this.deps.organizations.listProvisioningSummaries();
    const bySlug = all.find((summary) => summary.slug === organization);
    if (!bySlug) throw new StaffAccessNotFoundError();
    return bySlug;
  }
}

/** The door answered `opsRead:view` for an ops session only; any other session never gets here. */
function opsSessionOf(session: StaffAccessDoorSession): OpsSession {
  if (session.kind !== "ops") throw new StaffAccessNotFoundError();
  return session;
}
