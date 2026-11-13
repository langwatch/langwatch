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
import { reachesOrganization, type StaffAccessScope } from "@langwatch/authz-contract";
import type { CodingAgentApi } from "@langwatch/coding-agent-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
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
import { copyCatalog } from "./copy-catalog.ts";

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
    mail: [] as SendEmailCommand[],
    minted: [] as { apiKeyId: string; organizationId: string; kind: string; expiresAt: Date }[],
    revokedKeys: [] as string[],
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
  });

  const copy = copyCatalog();
  const summaries = [ACME, GLOBEX].map((organization) => ({
    ...organization,
    createdAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
  }));
  const organizations = createApiFixture<OrganizationApi>({
    findProvisioningSummary: async (id: string) =>
      summaries.find((summary) => summary.id === id) ?? null,
    listProvisioningSummaries: async () => summaries,
    getAllMembers: async () => [{ id: "member_1" }, { id: "member_2" }] as never,
    listTeams: copy.organizations.listTeams as never,
  });

  const projects = createApiFixture<ProjectApi>({
    listByOrganization: copy.projects.listByOrganization as never,
    findById: copy.projects.findById as never,
    createInOrganization: copy.projects.createInOrganization as never,
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
      state.revokedKeys.push(apiKeyId);
    },
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
      featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: async () => state.flag }),
      auth,
      users: createApiFixture<UserApi>({
        findById: async ({ id }) =>
          ({
            id,
            name: id === OLIVIA ? "Olivia" : "Pedro",
            email: `${id}@langwatch.test`,
          }) as never,
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
      }),
      gateway: createApiFixture<GatewayApi>({
        countUsage: async () => ({ requests: 120, spendUsd: 3.5 }),
      }),
      traces: createApiFixture<TraceApi>({
        countUsage: async () => ({ traces: 42, spans: 300 }),
      }),
      evaluators: copy.evaluators,
      monitors: copy.monitors,
      prompts: copy.prompts,
      datasets: copy.datasets,
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

  return { app, state, repositories, copy, operator, enrol, approve, advance, requesterSession };
}

/** A valid request body for the scopes given. */
export function requestBody({
  scopes,
  organization = ACME.slug,
  reason = "fix ACME's broken evaluator",
}: {
  scopes: StaffAccessScope[];
  organization?: string;
  reason?: string;
}) {
  return {
    scopes,
    ...(reachesOrganization(scopes) ? { organization } : {}),
    reason,
    codeChallenge: CHALLENGE,
    codeChallengeMethod: "S256" as const,
    machine: "olivia-macbook",
  };
}
