import type {
  GatewayApi,
  GatewayBudgetResolutionTarget,
  GatewayBudgetWithSeats,
  GatewayMoney,
  GatewayVirtualKeyRecord,
} from "@langwatch/gateway-contract";
import { type Project, type ProjectApi, projectSchema } from "@langwatch/project-contract";
/**
 * @vitest-environment node
 * @see enterprise/modules/licensing/specs/licensing.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { CONTRACT_BUDGET_EXTERNAL_ID } from "../contract-budget-store.service.ts";
import { HostedUsageReaderService } from "../hosted-usage-reader.service.ts";

const AT = Temporal.Instant.from("2026-09-29T00:00:00Z");
const CREATED = new Date("2026-01-01T00:00:00Z");
const CALLER = { virtualKeyId: "vk-1", organizationId: "org-1", projectId: "project-1" };

function money(value: string): GatewayMoney {
  return { toString: () => value, toFixed: (digits) => Number(value).toFixed(digits) };
}

function budget(overrides: Partial<GatewayBudgetWithSeats>): GatewayBudgetWithSeats {
  return {
    id: "budget-contract",
    organizationId: "org-1",
    scopeType: "ORGANIZATION",
    scopeId: "org-1",
    providerKey: null,
    name: "Hosted services contract",
    description: null,
    window: "MANUAL",
    limitUsd: money("1000.00"),
    onBreach: "BLOCK",
    timezone: null,
    externalId: CONTRACT_BUDGET_EXTERNAL_ID,
    metadata: {},
    spentUsd: money("250.50"),
    currentPeriodStartedAt: AT,
    resetsAt: AT,
    lastResetAt: null,
    cycleAnchorAt: null,
    archivedAt: null,
    createdAt: AT,
    updatedAt: AT,
    createdById: "system:connect-license",
    managedByVirtualKeyId: null,
    ...overrides,
  };
}

function project(): Project {
  return projectSchema.parse({
    id: "project-1",
    name: "Hidden",
    slug: "hidden",
    apiKey: "api-key",
    lwqlKey: "lwql-key",
    teamId: "team-1",
    language: "other",
    framework: "other",
    kind: "application",
    firstMessage: false,
    integrated: false,
    createdAt: CREATED,
    updatedAt: CREATED,
    userLinkTemplate: null,
    traceSharingEnabled: false,
    presenceEnabled: false,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    personalFeatures: {},
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
  });
}

function virtualKey(): GatewayVirtualKeyRecord {
  return {
    id: "vk-1",
    organizationId: "org-1",
    name: "Connect",
    description: null,
    status: "ACTIVE",
    purpose: "CONNECT",
    externalId: null,
    metadata: {},
    disabledAt: null,
    disabledReason: null,
    expiresAt: null,
    hashedSecret: "hashed",
    displayPrefix: "lw_vk_",
    principalUserId: "user-1",
    traceProjectId: null,
    config: {},
    revision: 1n,
    previousHashedSecret: null,
    previousSecretValidUntil: null,
    revokedAt: null,
    revokedById: null,
    createdAt: AT,
    updatedAt: AT,
    createdById: "system:connect-license",
    lastUsedAt: null,
    routingPolicyId: null,
    routingMode: "NONE",
    scopes: [],
    principalUser: null,
    routingPolicy: null,
  };
}

function readerOver({
  budgets,
  applicableIds,
  spendAvailable = true,
}: {
  budgets: GatewayBudgetWithSeats[];
  applicableIds: string[];
  spendAvailable?: boolean;
}) {
  const targets: GatewayBudgetResolutionTarget[] = [];
  const reader = HostedUsageReaderService.create({
    projects: createApiFixture<ProjectApi>({ findById: async () => project() }),
    gateway: createApiFixture<GatewayApi>({
      findVirtualKeyById: async () => virtualKey(),
      resolveApplicableBudgets: async (target) => {
        targets.push(target);
        return budgets
          .filter(({ id }) => applicableIds.includes(id))
          .map((applicable) => ({
            budget: applicable,
            bucketScopeId: applicable.scopeId,
            principalUserId: null,
            groupId: null,
            endUserId: null,
          }));
      },
      listBudgetsWithHealth: async () => ({
        budgets,
        spendAvailable,
        readAt: AT,
        scopeReach: new Map(),
      }),
    }),
  });
  return { reader, targets };
}

describe("the hosted usage a connected install reads", () => {
  describe("given organization budgets of which only some apply to the calling key", () => {
    /** @scenario "Hosted usage lists only the budgets that apply to the calling key" */
    it("lists the applicable budgets, the contract's marked, resolved for the key's team and principal", async () => {
      const { reader, targets } = readerOver({
        budgets: [
          budget({}),
          budget({ id: "budget-other-team", externalId: null, scopeType: "TEAM" }),
          budget({
            id: "budget-key",
            externalId: null,
            scopeType: "VIRTUAL_KEY",
            onBreach: "WARN",
          }),
        ],
        applicableIds: ["budget-contract", "budget-key"],
      });

      const usage = await reader.read(CALLER);

      expect(targets).toEqual([
        {
          organizationId: "org-1",
          virtualKeyId: "vk-1",
          teamId: "team-1",
          projectId: "project-1",
          principalUserId: "user-1",
        },
      ]);
      expect(usage.spendAvailable).toBe(true);
      expect(usage.budgets).toEqual([
        {
          id: "budget-contract",
          scope: "organization",
          window: "manual",
          limitUsd: 1000,
          spentUsd: 250.5,
          onBreach: "block",
          periodStartedAt: AT,
          isContract: true,
        },
        expect.objectContaining({ id: "budget-key", onBreach: "warn", isContract: false }),
      ]);
    });
  });

  describe("given live spend cannot be read", () => {
    /** @scenario "Hosted usage reports spend as unknown when live spend cannot be read" */
    it("answers each budget's spend as unknown rather than zero", async () => {
      const { reader } = readerOver({
        budgets: [budget({})],
        applicableIds: ["budget-contract"],
        spendAvailable: false,
      });

      const usage = await reader.read(CALLER);

      expect(usage.spendAvailable).toBe(false);
      expect(usage.budgets).toEqual([expect.objectContaining({ spentUsd: null })]);
    });
  });
});
