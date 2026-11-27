/**
 * A staff access module over real repositories and stand-in peers: operators, passkeys, an
 * organization, a clock, and recorders for the audit log, mail and minted keys.
 */
import { createHash, randomUUID } from "node:crypto";

import type { ApiKey, ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuditLogApi, RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import {
  type AuthApi,
  type PasskeyAssertionResponse,
  PasskeyAssertionRefusedError,
} from "@langwatch/auth-contract";
import type { CodingAgentApi } from "@langwatch/coding-agent-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import {
  type LangyApi,
  LangyConversationNotFoundError,
  type LangyTurnOutcomeCount,
} from "@langwatch/langy-contract";
import type { NotificationService, SendEmailCommand } from "@langwatch/notification-contract";
import type { OpsApi, OpsPlatformOperator } from "@langwatch/ops-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { StaffAccessApprovalChoice } from "@langwatch/staff-access-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { type Instant, Temporal, toDate } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";

import type { StaffAccessRepositories } from "../../../repositories/staff-access.repositories.ts";
import { StaffAccessModule } from "../../staff-access.app.ts";
import { activityPeers, type ActivityAsk } from "./staff-access-activity-peers.ts";
import {
  platformPeers,
  platformPeerState,
  type PlatformPeerState,
} from "./staff-access-platform-peers.ts";

export const OLIVIA = "user_olivia";
export const PEDRO = "user_pedro";
export const ACME = { id: "org_acme", slug: "acme", name: "ACME" };
export const GLOBEX = { id: "org_globex", slug: "globex", name: "Globex" };
export const AGENT_IP = "203.0.113.7";
export const VERIFIER = "v".repeat(43);
export const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

/** A fake passkey: it "signs" any challenge it is handed, with or without user verification. */
export function assertionOver({
  challenge,
  userVerified = true,
}: {
  challenge: string;
  userVerified?: boolean;
}): PasskeyAssertionResponse {
  const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge })).toString(
    "base64url",
  );
  return {
    id: "credential1",
    rawId: "credential1",
    type: "public-key",
    response: {
      clientDataJSON,
      authenticatorData: userVerified ? "dXY" : "bm8",
      signature: "c2lnbmVk",
    },
    clientExtensionResults: {},
  };
}

/** The challenge a fake assertion was made over. */
function challengeOf(response: PasskeyAssertionResponse): string {
  const parsed = JSON.parse(
    Buffer.from(response.response.clientDataJSON, "base64url").toString("utf8"),
  ) as { challenge: string };
  return parsed.challenge;
}

export type StaffAccessWorld = ReturnType<typeof staffAccessWorld>;

export function staffAccessWorld({
  repositories,
  publicBaseUrl = "https://app.langwatch.test",
}: {
  repositories: StaffAccessRepositories;
  publicBaseUrl?: string;
}) {
  const state = {
    at: Temporal.Instant.from("2026-11-02T10:00:00Z") as Instant,
    cloudOps: true,
    flag: true,
    operators: [OLIVIA, PEDRO],
    passkeys: new Set([OLIVIA]),
    audit: [] as RecordAuditLogCommand[],
    auditRefused: false,
    usersRefused: false,
    keyRevokeRefused: new Set<string>(),
    mail: [] as SendEmailCommand[],
    minted: [] as { apiKeyId: string; organizationId: string; kind: string; expiresAt: Date }[],
    revokedKeys: [] as string[],
    activityAsks: [] as ActivityAsk[],
    clickHouseErrorAsks: [] as Parameters<OpsApi["findClickHouseQueryErrors"]>[0][],
    platform: platformPeerState(),
  };

  const operators = (): OpsPlatformOperator[] =>
    state.operators.map((userId) => ({
      grantId: `grant_${userId}`,
      userId,
      name: userId === OLIVIA ? "Olivia" : "Pedro",
      email: `${userId}@langwatch.test`,
      grantedAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
    }));

  const ops = createApiFixture<OpsApi>({
    offersCloudOps: () => state.cloudOps,
    listPlatformOperators: async () => operators(),
    ...platformPeers.ops(state.platform),
    countQueueGroupsForTenants: async ({ tenantIds }) => [
      {
        queueName: "events",
        pendingGroups: tenantIds.length,
        blockedGroups: 0,
        activeGroups: 1,
        parkedGroups: 0,
        dlqGroups: 1,
        pendingJobs: 2,
        oldestPendingAt: Date.parse("2026-11-02T09:00:00Z"),
      },
    ],
    findClickHouseQueryErrors: async (input) => {
      state.clickHouseErrorAsks.push(input);
      return [
        {
          queryShapeId: "1234567890",
          source: "lwql",
          code: 241,
          codeName: "MEMORY_LIMIT_EXCEEDED",
          count: 5,
          p95Ms: 812,
          maxMemoryBytes: 10_000_000,
          rowsRead: 4_000,
          projectIds: [`${ACME.id}_project`],
          lastAt: Date.parse("2026-11-02T09:45:00Z"),
        },
      ];
    },
    getClickHouseHealth: async () => ({
      nodes: 2,
      replicas: { tables: 4, readonly: 0, sessionExpired: 0, maxDelaySeconds: 1, maxQueueSize: 3 },
      merges: { running: 1, longestSeconds: 12, pendingMutations: 0 },
      disks: { count: 2, totalBytes: 1_000, freeBytes: 400, lowestFreeRatio: 0.3 },
      memory: { residentBytes: 600, totalBytes: 1_000 },
      tables: [
        { table: "stored_spans", activeParts: 40, maxPartsInPartition: 12, bytesOnDisk: 900 },
        { table: "trace_summaries", activeParts: 8, maxPartsInPartition: 4, bytesOnDisk: 100 },
      ],
    }),
    listQueues: async () => [
      {
        name: "events",
        displayName: "Events",
        pendingGroupCount: 1,
        blockedGroupCount: 0,
        activeGroupCount: 2,
        parkedGroupCount: 0,
        totalPendingJobs: 3,
        dlqCount: 0,
      },
    ],
  } as Partial<OpsApi>);

  const auth = createApiFixture<AuthApi>({
    hasPasskey: async ({ userId }) => state.passkeys.has(userId),
    passkeyAssertionOptions: async ({ challenge }) => ({
      challenge,
      rpId: "langwatch.test",
      timeout: 60_000,
      userVerification: "required",
      allowCredentials: [{ id: "credential1", type: "public-key" }],
    }),
    verifyPasskeyAssertion: async ({ userId, challenge, response }) => {
      if (!state.passkeys.has(userId)) {
        throw new PasskeyAssertionRefusedError({ reason: "unknown_credential" });
      }
      if (response.response.authenticatorData !== "dXY") {
        throw new PasskeyAssertionRefusedError({ reason: "user_verification_missing" });
      }
      if (challengeOf(response) !== challenge) {
        throw new PasskeyAssertionRefusedError({ reason: "bad_signature" });
      }
      return { credentialId: "credential1" };
    },
    countUsageForMembers: async ({ memberUserIds }) => ({ signedInUsers: memberUserIds.length }),
    findSignInFacts: async ({ email }) =>
      email === "olivia@acme.test"
        ? [
            {
              userId: "user_acme_olivia",
              createdAt: Date.parse("2026-01-01T00:00:00Z"),
              lastSignInAt: Date.parse("2026-11-01T07:00:00Z"),
              methods: ["password", "google"],
              passkeys: 1,
              twoStepEnabled: false,
              locked: false,
              deactivated: false,
            },
          ]
        : [],
    ...activityPeers.auth(),
  });

  const summaries = [ACME, GLOBEX].map((organization) => ({
    ...organization,
    createdAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
  }));
  const organizations = createApiFixture<OrganizationApi>({
    findInviteFacts: async ({ organizationId }) => peopleInviteFacts({ organizationId }),
    listMembers: async (input) => peopleMembers(input),
    getInvitedMemberIds: async ({ organizationId }) => ({
      memberUserIds: [],
      invitedUserIds: organizationId === ACME.id ? ["user_acme_ben"] : [],
    }),
    organizationIdsForMember: async (input) => peopleOrganizationIds(input),
    listAllIds: async () => ({ ids: [ACME.id, GLOBEX.id, "org_empty"], next: null }),
    countMemberSeats: async ({ organizationId }) => peopleSeats({ organizationId }),
    findProvisioningSummary: async (id: string) =>
      summaries.find((summary) => summary.id === id) ?? null,
    listProvisioningSummaries: async () => summaries,
    getAllMembers: async () => [{ id: "member_1" }, { id: "member_2" }] as never,
    getOpsSnapshot: async ({ organizationId }) => ({
      organizationId,
      createdAt: Date.parse("2025-01-01T00:00:00Z"),
      membersCount: 2,
      pendingInvitesCount: 1,
      teamsCount: 1,
      projectIds: [`${organizationId}_project`],
    }),
  });

  const projects = createApiFixture<ProjectApi>({
    listByOrganization: async ({ organizationId }) =>
      ({
        data: [{ id: `${organizationId}_project`, slug: "acme-support", name: "acme-support" }],
        pagination: { page: 1, limit: 100, total: 1 },
      }) as never,
    listIdsByOrganization: async ({ organizationId }) => [`${organizationId}_project`],
  });

  let keyCounter = 0;
  const apiKeys = createApiFixture<ApiKeyApi>({
    mintStaffAccessKey: async ({ organizationId, kind, expiresAt }) => {
      keyCounter += 1;
      const apiKeyId = `key_${randomUUID()}`;
      state.minted.push({ apiKeyId, organizationId, kind, expiresAt });
      return { token: `sk-lw-staff-${keyCounter}`, apiKeyId };
    },
    revokeStaffAccessKey: async ({ apiKeyId }) => {
      if (state.keyRevokeRefused.has(apiKeyId)) throw new Error("api key store unavailable");
      state.revokedKeys.push(apiKeyId);
    },
    findKeyFactsForOrganization: async () => [
      {
        id: "key_customer",
        kind: "service",
        projectId: `${ACME.id}_project`,
        createdAt: Date.parse("2026-01-01T00:00:00Z"),
        lastUsedAt: Date.parse("2026-11-01T09:00:00Z"),
        expiresAt: null,
        revokedAt: null,
        permissions: ["traces:create"],
      },
    ],
    listAll: async (): Promise<ApiKey[]> => [
      {
        id: "key_customer",
        name: "CI",
        description: null,
        organizationId: ACME.id,
        userId: null,
        createdByUserId: null,
        createdByDeviceLabel: null,
        lookupId: "lookup_customer",
        permissionMode: "all",
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: toDate(Temporal.Instant.from("2026-11-01T09:00:00Z")),
        ingestSourceType: null,
        ingestionTemplateId: null,
        createdAt: toDate(Temporal.Instant.from("2026-01-01T00:00:00Z")),
        updatedAt: toDate(Temporal.Instant.from("2026-01-01T00:00:00Z")),
        grants: [],
      },
    ],
  });

  const auditLog = createApiFixture<AuditLogApi>({
    record: async (command) => {
      if (state.auditRefused) throw new Error("audit log unavailable");
      state.audit.push(command);
      return { id: `audit_${state.audit.length}`, occurredAt: 0 };
    },
    hasRecordedSince: async ({ userId, action, targetKind, targetId, organizationId }) =>
      state.audit.some(
        (row) =>
          row.userId === userId &&
          row.action === action &&
          row.targetKind === targetKind &&
          row.targetId === targetId &&
          (organizationId === undefined || row.organizationId === organizationId),
      ),
  });

  const notifications = createApiFixture<NotificationService>({
    sendEmail: async (command) => {
      state.mail.push(command);
    },
  });

  const app = StaffAccessModule.create({
    repositories,
    config: { publicBaseUrl },
    dependencies: {
      ops,
      langy: langyStandIn(state.platform),
      monitors: platformPeers.monitors(),
      dataRetention: platformPeers.dataRetention(),
      featureFlags: createApiFixture<FeatureFlagApi>({
        isEnabled: async () => state.flag,
        findEnabledFlagsForOrganization: async () => ["release_trace_media_extraction"],
      }),
      auth,
      users: createApiFixture<UserApi>({
        findSignInAccounts: async ({ email }) => peopleSignInAccounts({ email }),
        getProfiles: async ({ userIds }) => peopleProfiles({ userIds }) as never,
        findById: async ({ id }) => {
          if (state.usersRefused) throw new Error("user store unavailable");
          return {
            id,
            name: id === OLIVIA ? "Olivia" : "Pedro",
            email: `${id}@langwatch.test`,
          } as never;
        },
      }),
      organizations,
      projects,
      apiKeys,
      auditLog,
      notifications,
      codingAgents: createApiFixture<CodingAgentApi>({
        countUsage: async ({ since }) => ({
          sessions: since !== undefined && since > Date.parse("2026-10-20T00:00:00Z") ? 4 : 9,
          lastSessionAt: Date.parse("2026-11-01T08:00:00Z"),
        }),
        ...activityPeers.codingAgents(state.activityAsks),
      }),
      gateway: createApiFixture<GatewayApi>({
        countUsage: async () => ({ requests: 120, spendUsd: 3.5 }),
        ...activityPeers.gateway(state.activityAsks),
      }),
      traces: createApiFixture<TraceApi>({
        countUsage: async () => ({ traces: 42, spans: 300 }),
        countIngestionByProject: async ({ projectIds }) =>
          projectIds.map((projectId) => ({
            projectId,
            traces: 42,
            lastTraceAt: Date.parse("2026-11-02T09:30:00Z"),
            planLimitRefusals: 3,
          })),
        findTracePresence: async ({ projectId, traceId }) =>
          traceId === "trace_stored"
            ? [
                {
                  projectId,
                  traceId,
                  firstSeenAt: Date.parse("2026-11-02T09:00:00Z"),
                  lastSeenAt: Date.parse("2026-11-02T09:00:05Z"),
                  spanCount: 7,
                },
              ]
            : [],
      }),
      entitlements: createApiFixture<EntitlementApi>({
        getActivePlan: async ({ organizationId }) => peoplePlan({ organizationId }) as never,
        getUsageLimits: async () => ({
          plan: "growth",
          limits: [
            { name: "traces_per_month", cap: 200_000, used: 199_000 },
            { name: "members", cap: null, used: null },
          ],
        }),
      }),
      evaluations: createApiFixture<EvaluationApi>({
        countEvaluatorOutcomes: async ({ projectIds }) =>
          projectIds.map((projectId) => ({
            projectId,
            evaluatorId: "monitor_1",
            evaluatorType: "langevals/llm_boolean",
            runs: 10,
            errors: 4,
            skipped: 1,
            errorsByCode: [{ code: "provider_rate_limited", count: 4 }],
            lastErrorAt: Date.parse("2026-11-02T08:00:00Z"),
          })),
        ...platformPeers.evaluatorUsage(state.platform),
      }),
      instantEvals: activityPeers.instantEvals(state.activityAsks),
      scenarios: activityPeers.scenarios(state.activityAsks, [ACME.id]),
    },
    now: () => state.at,
  } as Parameters<typeof StaffAccessModule.create>[0]);

  const operator = (userId: string) => ({ actor: { type: "user", id: userId } });
  const requesterSession = (requester: { requesterId: string; ownerUserId: string }) => ({
    kind: "requester" as const,
    ...requester,
    ipAddress: AGENT_IP,
    userAgent: "langwatch-cli",
  });

  /** Olivia enrols an agent through the passkey ceremony; answers its key and session. */
  async function enrol({ userId = OLIVIA, name = "laptop agent" } = {}) {
    const options = await app.enrolOptions(operator(userId));
    const enrolled = await app.enrol({
      ...operator(userId),
      name,
      assertion: assertionOver({ challenge: options.challenge }),
    });
    return {
      ...enrolled,
      session: requesterSession({ requesterId: enrolled.requester.id, ownerUserId: userId }),
    };
  }

  /** Approves with a passkey over exactly the challenge the options offered. */
  async function approve({
    userId = OLIVIA,
    choice,
  }: {
    userId?: string;
    choice: StaffAccessApprovalChoice;
  }) {
    const options = await app.approvalOptions({ ...operator(userId), ...choice });
    return app.approve({
      ...operator(userId),
      ...choice,
      assertion: assertionOver({ challenge: options.challenge }),
    });
  }

  function advance({ minutes }: { minutes: number }) {
    state.at = state.at.add({ minutes });
  }

  return { app, state, repositories, operator, enrol, approve, advance, requesterSession };
}

/** A valid request body for the scopes given. */
export function requestBody({
  scopes,
  organization = ACME.slug,
  reason = "fix ACME's broken evaluator",
  functions,
}: {
  scopes: ("ops:read" | "org:metadata" | "org:content" | "org:support")[];
  organization?: string;
  reason?: string;
  functions?: string[];
}) {
  const reachesOrganization = scopes.some((scope) => scope !== "ops:read");
  const metadataOnly =
    scopes.includes("org:metadata") &&
    !scopes.includes("org:content") &&
    !scopes.includes("org:support");
  const named = functions ?? (metadataOnly ? ["org.snapshot"] : []);
  return {
    ...(named.length > 0 ? { functions: named } : {}),
    scopes,
    ...(reachesOrganization ? { organization } : {}),
    reason,
    codeChallenge: CHALLENGE,
    codeChallengeMethod: "S256" as const,
    machine: "olivia-macbook",
  };
}

/** Langy as staff access sees it: one conversation in ACME's project with two turns. */
export function langyStandIn(platform: PlatformPeerState = platformPeerState()) {
  return createApiFixture<LangyApi>({
    ...platformPeers.mirror(platform),
    findTurnOutcomeCounts: async ({ projectIds }): Promise<LangyTurnOutcomeCount[]> =>
      projectIds.includes(`${ACME.id}_project`)
        ? [
            {
              day: "2026-11-01",
              model: "openai/gpt-5.4-mini",
              turnState: "failed",
              failureCode: "langy_agent_errored",
              toolErrorsByTool: { "langwatch.trace": 2 },
              turns: 3,
              users: 2,
            },
            {
              day: "2026-11-01",
              model: "openai/gpt-5.4-mini",
              turnState: "completed",
              failureCode: null,
              toolErrorsByTool: {},
              turns: 9,
              users: 4,
            },
          ]
        : [],
    getTurnFacts: async ({ projectId, conversationId }) => {
      if (projectId !== `${ACME.id}_project` || conversationId !== "conv_acme") {
        throw new LangyConversationNotFoundError(conversationId);
      }
      return [
        {
          turnId: "turn_1",
          state: "completed",
          failureCode: null,
          createdAt: Date.parse("2026-11-01T09:00:00Z"),
          startedAt: Date.parse("2026-11-01T09:00:01Z"),
          endedAt: Date.parse("2026-11-01T09:00:30Z"),
          toolCalls: [
            {
              tool: "langwatch.dashboards",
              status: "succeeded",
              durationMs: 800,
              waitKind: null,
              targetKind: "dashboard",
              targetId: "dash_open",
            },
          ],
        },
        {
          turnId: "turn_2",
          state: "failed",
          failureCode: "langy_turn_timeout",
          createdAt: Date.parse("2026-11-01T09:05:00Z"),
          startedAt: Date.parse("2026-11-01T09:05:01Z"),
          endedAt: null,
          toolCalls: [
            {
              tool: "bash",
              status: "failed",
              durationMs: 120,
              waitKind: "permission",
              targetKind: null,
              targetId: null,
            },
          ],
        },
      ];
    },
  });
}

/** ACME's invitations for the people functions: pending, expired and held for a checkout. */
function peopleInviteFacts({ organizationId }: { organizationId: string }) {
  if (organizationId !== ACME.id) return [];
  const invite = ({
    inviteId,
    role = "MEMBER",
    status,
    viaCheckout = false,
    teamIds = ["team_acme"],
    createdAt,
    expiresAt,
  }: {
    inviteId: string;
    role?: "ADMIN" | "MEMBER";
    status: "PENDING" | "EXPIRED" | "PAYMENT_PENDING";
    viaCheckout?: boolean;
    teamIds?: string[];
    createdAt: string;
    expiresAt: string | null;
  }) => ({
    inviteId,
    role,
    status,
    billingOnly: false,
    viaCheckout,
    teamIds,
    requestedByUserId: "user_acme_olivia",
    acceptedByUserId: null,
    createdAt: Date.parse(createdAt),
    updatedAt: Date.parse(createdAt),
    expiresAt: expiresAt === null ? null : Date.parse(expiresAt),
  });
  return [
    invite({
      inviteId: "invite_pending",
      status: "PENDING",
      createdAt: "2026-11-01T10:00:00Z",
      expiresAt: "2026-11-03T10:00:00Z",
    }),
    invite({
      inviteId: "invite_expired",
      role: "ADMIN",
      status: "EXPIRED",
      teamIds: [],
      createdAt: "2026-10-01T10:00:00Z",
      expiresAt: "2026-10-03T10:00:00Z",
    }),
    invite({
      inviteId: "invite_checkout",
      status: "PAYMENT_PENDING",
      viaCheckout: true,
      createdAt: "2026-10-20T10:00:00Z",
      expiresAt: null,
    }),
  ];
}

/** ACME's members, one switched off and one with a role the reads do not know, with names. */
function peopleMembers({
  organizationId,
  offset = 0,
  limit = 50,
}: {
  organizationId: string;
  offset?: number;
  limit?: number;
}) {
  const at = Temporal.Instant.from("2026-02-01T00:00:00Z");
  const members =
    organizationId === ACME.id
      ? [
          { userId: "user_acme_olivia", role: "ADMIN", disabledAt: null },
          { userId: "user_acme_ben", role: "MEMBER", disabledAt: at },
          { userId: "user_acme_lee", role: "OWNER", disabledAt: null },
        ]
      : [{ userId: "user_globex_kim", role: "ADMIN", disabledAt: null }];
  const rows = members.map((member) => ({
    ...member,
    organizationId,
    createdAt: at,
    updatedAt: at,
    user: { id: member.userId, name: "Olivia Acme", email: `${member.userId}@acme.test` },
  }));
  return { members: rows.slice(offset, offset + limit) as never, totalCount: rows.length };
}

function peopleOrganizationIds({ userId, activeOnly }: { userId: string; activeOnly?: boolean }) {
  if (userId !== "user_acme_olivia") return [];
  return activeOnly ? [ACME.id] : [GLOBEX.id, ACME.id];
}

/** ACME over both caps, Globex at its cap, and an organization with nobody in it. */
function peopleSeats({ organizationId }: { organizationId: string }) {
  const seats: Record<string, { fullMembers: number; liteMembers: number; developers: number }> = {
    [ACME.id]: { fullMembers: 12, liteMembers: 3, developers: 4 },
    [GLOBEX.id]: { fullMembers: 2, liteMembers: 0, developers: 0 },
  };
  return seats[organizationId] ?? { fullMembers: 0, liteMembers: 0, developers: 0 };
}

function peopleSignInAccounts({ email }: { email: string }) {
  if (email !== "olivia@acme.test") return [];
  return [
    {
      userId: "user_acme_olivia",
      createdAt: Date.parse("2026-01-01T00:00:00Z"),
      lastSignInAt: Date.parse("2026-11-01T07:00:00Z"),
      methods: ["password" as const],
      twoStepEnabled: false,
      deactivated: false,
    },
  ];
}

function peopleProfiles({ userIds }: { userIds: readonly string[] }) {
  return userIds.map((id) => ({
    id,
    name: "Olivia Acme",
    email: `${id}@acme.test`,
    lastLoginAt: id === "user_acme_olivia" ? new Date("2026-11-01T07:00:00Z") : null,
    deactivatedAt: id === "user_acme_lee" ? new Date("2026-06-01T00:00:00Z") : null,
  }));
}

/** ACME on a seat plan it went over; everybody else on Free with unlimited Lite seats. */
function peoplePlan({ organizationId }: { organizationId: string }) {
  if (organizationId !== ACME.id) {
    return { type: "FREE", maxMembers: 2, maxMembersLite: Number.MAX_SAFE_INTEGER, overPlan: null };
  }
  return {
    type: "GROWTH_SEAT_EUR_MONTHLY",
    maxMembers: 10,
    maxMembersLite: 2,
    overPlan: { sinceMs: Date.parse("2026-10-15T00:00:00Z"), members: 12, maxMembers: 10 },
  };
}
