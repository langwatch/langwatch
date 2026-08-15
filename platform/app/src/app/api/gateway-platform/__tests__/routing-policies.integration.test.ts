/**
 * @vitest-environment node
 *
 * Integration tests for the routing-policies REST API.
 * Spec: specs/ai-gateway/governance/routing-policy-rest-read.feature
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RoutingPolicyScopeType } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { app } from "../[[...route]]/app";
import { createTestApp } from "~/server/app-layer/presets";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { PlanProviderService } from "~/server/app-layer/subscription/plan-provider";
import { ENTERPRISE_TEST_PLAN } from "~/test-utils/managementApiOrg";

const jsonHeaders = { "Content-Type": "application/json" };

function apiKeyAuth(
  token: string,
  projectId: string = PROJECT_ID,
): Record<string, string> {
  return {
    "X-Auth-Token": token,
    "X-Project-Id": projectId,
    ...jsonHeaders,
  };
}

const suffix = nanoid(8);
const ORG_ID = `org-rp-${suffix}`;
const TEAM_ID = `team-rp-${suffix}`;
const PROJECT_ID = `proj-rp-${suffix}`;
const SIBLING_PROJECT_ID = `proj-rp-sib-${suffix}`;

const POLICY_PROJECT_ID = `pol-rp-project-${suffix}`;
const POLICY_TEAM_ID = `pol-rp-team-${suffix}`;
const POLICY_ORG_ID = `pol-rp-org-${suffix}`;
const POLICY_SIBLING_ID = `pol-rp-sibling-${suffix}`;

const FOREIGN_ORG_ID = `org-rp-foreign-${suffix}`;
const FOREIGN_POLICY_ID = `pol-rp-foreign-${suffix}`;

let projectApiKey: string;
let foreignProjectApiKey: string;

beforeAll(async () => {
  // Routing policies are Enterprise-gated on every route, and this suite is about
  // the family's behavior, not the gate, so the fixture organization is
  // entitled. The gate's own coverage lives in the enterprise-gate tests.
  await resetApp();
  globalForApp.__langwatch_app = createTestApp({
    planProvider: PlanProviderService.create({
      getActivePlan: async () => ENTERPRISE_TEST_PLAN,
    }),
  });

  // Setup organizations and teams
  await prisma.organization.create({
    data: {
      id: ORG_ID,
      name: `Test Org ${suffix}`,
      slug: `test-org-${suffix}`,
    },
  });
  await prisma.organization.create({
    data: {
      id: FOREIGN_ORG_ID,
      name: `Foreign Org ${suffix}`,
      slug: `foreign-org-${suffix}`,
    },
  });
  
  // Setup enterprise subscriptions for the organizations
  await prisma.subscription.create({
    data: {
      organizationId: ORG_ID,
      plan: "ENTERPRISE",
      status: "ACTIVE",
    },
  });
  await prisma.subscription.create({
    data: {
      organizationId: FOREIGN_ORG_ID,
      plan: "ENTERPRISE",
      status: "ACTIVE",
    },
  });

  await prisma.team.create({
    data: {
      id: TEAM_ID,
      name: `Test Team ${suffix}`,
      organizationId: ORG_ID,
      slug: `test-team-${suffix}`,
    },
  });

  // Setup projects
  const LEGACY_KEY = `sk-lw-${nanoid(48)}`;
  const SIBLING_LEGACY_KEY = `sk-lw-${nanoid(48)}`;
  
  await prisma.project.create({
    data: {
      id: PROJECT_ID,
      name: `Test Project ${suffix}`,
      teamId: TEAM_ID,
      slug: `test-project-${suffix}`,
      apiKey: LEGACY_KEY,
      language: "typescript",
      framework: "node",
    },
  });
  await prisma.project.create({
    data: {
      id: SIBLING_PROJECT_ID,
      name: `Sibling Project ${suffix}`,
      teamId: TEAM_ID,
      slug: `sibling-project-${suffix}`,
      apiKey: SIBLING_LEGACY_KEY,
      language: "typescript",
      framework: "node",
    },
  });

  // Setup routing policies with different scopes
   await prisma.routingPolicy.createMany({
    data: [
      {
        id: POLICY_PROJECT_ID,
        name: `Project Policy ${suffix}`,
        description: `Policy scoped to project ${suffix}`,
        strategy: "priority",
        isDefault: false,
        organizationId: ORG_ID,
      },
      {
        id: POLICY_TEAM_ID,
        name: `Team Policy ${suffix}`,
        description: `Policy scoped to team ${suffix}`,
        strategy: "cost",
        isDefault: false,
        organizationId: ORG_ID,
      },
      {
        id: POLICY_ORG_ID,
        name: `Org Policy ${suffix}`,
        description: `Policy scoped to org ${suffix}`,
        strategy: "latency",
        isDefault: false,
        organizationId: ORG_ID,
      },
      {
        id: POLICY_SIBLING_ID,
        name: `Sibling Policy ${suffix}`,
        description: `Policy scoped to sibling project ${suffix}`,
        strategy: "round_robin",
        isDefault: false,
        organizationId: ORG_ID,
      },
      {
        id: FOREIGN_POLICY_ID,
        name: `Foreign Policy ${suffix}`,
        description: `Policy in foreign org ${suffix}`,
        strategy: "priority",
        isDefault: false,
        organizationId: FOREIGN_ORG_ID,
      },
    ],
  });

  // Setup policy scopes
  await prisma.routingPolicyScope.createMany({
    data: [
      // Project policy scoped to PROJECT_ID
      {
        routingPolicyId: POLICY_PROJECT_ID,
        scopeType: RoutingPolicyScopeType.PROJECT,
        scopeId: PROJECT_ID,
      },
      // Team policy scoped to TEAM_ID
      {
        routingPolicyId: POLICY_TEAM_ID,
        scopeType: RoutingPolicyScopeType.TEAM,
        scopeId: TEAM_ID,
      },
      // Org policy scoped to ORG_ID
      {
        routingPolicyId: POLICY_ORG_ID,
        scopeType: RoutingPolicyScopeType.ORGANIZATION,
        scopeId: ORG_ID,
      },
      // Sibling policy scoped only to SIBLING_PROJECT_ID
      {
        routingPolicyId: POLICY_SIBLING_ID,
        scopeType: RoutingPolicyScopeType.PROJECT,
        scopeId: SIBLING_PROJECT_ID,
      },
      // Foreign policy scoped to foreign org
      {
        routingPolicyId: FOREIGN_POLICY_ID,
        scopeType: RoutingPolicyScopeType.ORGANIZATION,
        scopeId: FOREIGN_ORG_ID,
      },
    ],
  });

  // Use the project's own apiKey for authentication
  projectApiKey = LEGACY_KEY;
  foreignProjectApiKey = SIBLING_LEGACY_KEY;
});

afterAll(async () => {
  // Cleanup
  await prisma.routingPolicyScope.deleteMany({
    where: {
      routingPolicyId: {
        in: [POLICY_PROJECT_ID, POLICY_TEAM_ID, POLICY_ORG_ID, POLICY_SIBLING_ID, FOREIGN_POLICY_ID],
      },
    },
  });

  await prisma.routingPolicy.deleteMany({
    where: {
      id: {
        in: [POLICY_PROJECT_ID, POLICY_TEAM_ID, POLICY_ORG_ID, POLICY_SIBLING_ID, FOREIGN_POLICY_ID],
      },
    },
  });

  // No separate API keys to clean up - we used project apiKey fields

  await prisma.project.deleteMany({
    where: {
      id: {
        in: [PROJECT_ID, SIBLING_PROJECT_ID],
      },
    },
  });

  await prisma.team.deleteMany({
    where: {
      id: TEAM_ID,
    },
  });

  // Clean up subscriptions first to avoid foreign key constraints
  await prisma.subscription.deleteMany({
    where: {
      organizationId: {
        in: [ORG_ID, FOREIGN_ORG_ID],
      },
    },
  });
  
  await prisma.organization.deleteMany({
    where: {
      id: {
        in: [ORG_ID, FOREIGN_ORG_ID],
      },
    },
  });
});

  describe("GET /routing-policies", () => {
    it("returns exactly the policies selectable at the project's scope", async () => {
      const response = await app.request(
        `/api/gateway/v1/routing-policies`,
        {
          method: "GET",
          headers: apiKeyAuth(projectApiKey),
        },
      );

    expect(response.status).toBe(200);
    const body = await response.json();
    
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
    
    const returnedIds = new Set(body.data.map((p: any) => p.id));
    expect(returnedIds).toEqual(
      new Set([POLICY_PROJECT_ID, POLICY_TEAM_ID, POLICY_ORG_ID]),
    );
  });

  it("returns policy objects with exactly the five-field summary subset", async () => {
    const response = await app.request(
      `/api/gateway/v1/routing-policies`,
      {
        method: "GET",
        headers: apiKeyAuth(projectApiKey),
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.data.length).toBeGreaterThan(0);
    
    for (const policy of body.data) {
      const keys = Object.keys(policy);
      expect(keys).toEqual(["id", "name", "description", "strategy", "is_default"]);
      
      // Ensure no sensitive fields are included
      expect(policy).not.toHaveProperty("policyRules");
      expect(policy).not.toHaveProperty("modelAliases");
      expect(policy).not.toHaveProperty("modelAllowlist");
      expect(policy).not.toHaveProperty("modelProviderIds");
      expect(policy).not.toHaveProperty("organizationId");
      expect(policy).not.toHaveProperty("scopes");
    }
  });

  it("never returns another organization's policies", async () => {
    const response = await app.request(
      `/api/gateway/v1/routing-policies`,
      {
        method: "GET",
        headers: apiKeyAuth(projectApiKey),
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    const returnedIds = new Set(body.data.map((p: any) => p.id));
    expect(returnedIds).not.toContain(FOREIGN_POLICY_ID);
  });

  it("never returns a same-org sibling project's private policies", async () => {
    const response = await app.request(
      `/api/gateway/v1/routing-policies`,
      {
        method: "GET",
        headers: apiKeyAuth(projectApiKey),
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    const returnedIds = new Set(body.data.map((p: any) => p.id));
    expect(returnedIds).not.toContain(POLICY_SIBLING_ID);
  });
});

  describe("GET /routing-policies/:id", () => {
    it("returns the same five-field subset", async () => {
      const response = await app.request(
        `/api/gateway/v1/routing-policies/${POLICY_PROJECT_ID}`,
        {
          method: "GET",
          headers: apiKeyAuth(projectApiKey),
        },
      );

    expect(response.status).toBe(200);
    const body = await response.json();

    const keys = Object.keys(body);
    expect(keys).toEqual(["id", "name", "description", "strategy", "is_default"]);
  });

  it("returns 404 for a policy in another organization", async () => {
    const response = await app.request(
      `/api/gateway/v1/routing-policies/${FOREIGN_POLICY_ID}`,
      {
        method: "GET",
        headers: apiKeyAuth(projectApiKey),
      },
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    console.log("DEBUG: Response body:", JSON.stringify(body, null, 2));
    expect(body.error).toHaveProperty("code", "routing_policy_not_found");
  });

  it("returns 404 for a sibling project's private policy", async () => {
    const response = await app.request(
      `/api/gateway/v1/routing-policies/${POLICY_SIBLING_ID}`,
      {
        method: "GET",
        headers: apiKeyAuth(projectApiKey),
      },
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toHaveProperty("code", "routing_policy_not_found");
  });

  it("returns 404 for a non-existent policy id", async () => {
    const response = await app.request(
      `/api/gateway/v1/routing-policies/non-existent-id`,
      {
        method: "GET",
        headers: apiKeyAuth(projectApiKey),
      },
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toHaveProperty("code", "routing_policy_not_found");
  });

  it("allows fetching an ORGANIZATION-scoped policy", async () => {
    const policyId = `pol-org-scoped-${nanoid(8)}`;
    await prisma.routingPolicy.create({
      data: {
        id: policyId,
        organizationId: ORG_ID,
        name: "Org Policy",
        strategy: "priority",
        isDefault: false,
        createdById: "user",
        updatedById: "user",
        scopes: {
          create: [{ scopeType: RoutingPolicyScopeType.ORGANIZATION, scopeId: ORG_ID }],
        },
      },
    });

    const res = await app.request(`/api/gateway/v1/routing-policies/${policyId}`, {
      method: "GET",
      headers: apiKeyAuth(projectApiKey),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(policyId);
  });
});
