// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The console's anomaly-rule ops over memory rows: main's Enterprise gate is a
 * per-organization refusal here, and a bad config reads as main's handled complaint.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import { DEFAULT_SPEND_SPIKE_CONFIG } from "@langwatch/enterprise-governance-contract";
import type { ScimApi } from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { ResourceScope } from "@langwatch/kernel";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { MemoryGovernanceRepositories } from "../../repositories/memory/memory.governance.repositories.ts";
import { GovernanceApp } from "../governance.app.ts";
import type { GovernanceEncryptor } from "../governance.members.ts";

const ADMIN = { id: "user-1" };

function planOfType(type: string): Plan {
  return {
    planSource: "subscription",
    type,
    name: type,
    free: type === "FREE",
    maxMembers: 10,
    maxMembersLite: 10,
    maxMessagesPerMonth: 1000,
    canPublish: true,
    prices: { USD: 0, EUR: 0 },
  };
}

async function buildApp(planType: string) {
  const plansAsked: unknown[] = [];
  const app = await GovernanceApp.create({
    config: void 0,
    repositories: MemoryGovernanceRepositories.create(),
    dependencies: {
      projects: createApiFixture<ProjectApi>(),
      auth: createApiFixture<AuthApi>(),
      entitlements: createApiFixture<EntitlementApi>({
        getActivePlan: async (input) => {
          plansAsked.push(input);
          return planOfType(planType);
        },
      }),
      organizations: createApiFixture<OrganizationApi>(),
      permissions: createApiFixture<AuthzApi>(),
      scim: createApiFixture<ScimApi>(),
      featureFlags: createApiFixture<FeatureFlagApi>(),
      traces: createApiFixture<TraceApi>(),
      apiKeys: createApiFixture<ApiKeyApi>(),
      gateway: createApiFixture<GatewayApi>(),
      modelProviders: createApiFixture<ModelProviderApi>(),
      users: createApiFixture<UserApi>(),
      auditLog: createApiFixture<AuditLogApi>(),
    },
    members: {
      encryption: createApiFixture<GovernanceEncryptor>(),
      isSaas: false,
    },
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
  });
  return { app, plansAsked };
}

const rule = {
  organizationId: "org-1",
  name: "Spend spike",
  severity: "warning",
  ruleType: "spend_spike",
  scope: "organization",
  scopeId: "org-1",
  actorUserId: ADMIN.id,
} as const;

describe("anomaly rules from the console", () => {
  describe("given an organization on the Enterprise plan", () => {
    it("creates a rule and lists it back", async () => {
      const { app } = await buildApp("ENTERPRISE");

      const created = await app.anomalyRuleCreate(
        { ...rule, thresholdConfig: { ...DEFAULT_SPEND_SPIKE_CONFIG } },
        ADMIN,
      );

      await expect(app.anomalyRuleList({ organizationId: "org-1" }, ADMIN)).resolves.toEqual([
        created,
      ]);
    });

    it("refuses a threshold config that fails its schema as a handled validation error", async () => {
      const { app } = await buildApp("ENTERPRISE");

      await expect(
        app.anomalyRuleCreate({ ...rule, thresholdConfig: { windowSec: "soon" } }, ADMIN),
      ).rejects.toMatchObject({ code: "validation_error" });
    });

    it("resolves the plan for the organization, as the signed-in person", async () => {
      const { app, plansAsked } = await buildApp("ENTERPRISE");

      await app.anomalyRuleList({ organizationId: "org-1" }, ADMIN);

      expect(plansAsked).toEqual([{ organizationId: "org-1", operator: { id: "user-1" } }]);
    });
  });

  describe("given a platform operator impersonating the admin", () => {
    it("resolves the plan as the admin, naming the impersonating operator", async () => {
      const { app, plansAsked } = await buildApp("ENTERPRISE");

      await app.anomalyRuleList(
        { organizationId: "org-1" },
        { id: ADMIN.id, impersonatorId: "staff-1" },
      );

      expect(plansAsked).toEqual([
        { organizationId: "org-1", operator: { id: "user-1", impersonatorId: "staff-1" } },
      ]);
    });
  });

  describe("given an organization not on the Enterprise plan", () => {
    it("refuses every rule operation by the plan code", async () => {
      const { app } = await buildApp("FREE");

      await expect(app.anomalyRuleList({ organizationId: "org-1" }, ADMIN)).rejects.toMatchObject({
        code: "enterprise_plan_required",
      });
      await expect(app.anomalyRuleCreate(rule, ADMIN)).rejects.toMatchObject({
        code: "enterprise_plan_required",
      });
    });
  });
});

describe("the OCSF export, an Enterprise feature refused per organization", () => {
  const page = { organizationId: "org-1", sinceMs: 0, limit: 500 };

  it("refuses an organization not on the Enterprise plan by the plan code", async () => {
    const { app } = await buildApp("FREE");

    await expect(app.governanceOcsfExport(page, ADMIN)).rejects.toMatchObject({
      code: "enterprise_plan_required",
    });
  });

  it("pages the events of an Enterprise organization", async () => {
    const { app } = await buildApp("ENTERPRISE");

    await expect(app.governanceOcsfExport(page, ADMIN)).resolves.toMatchObject({ events: [] });
  });
});
