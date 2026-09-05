/**
 * The plan gate over the management REST families: organization, custom roles, role
 * bindings, SCIM tokens and groups.
 * @see specs/licensing/management-apis-enterprise-gate.feature
 */
import { createHash, randomUUID } from "node:crypto";

import { createEnterprisePlanGate } from "@langwatch/enterprise-plan-gate";
import { ScimApp, type ScimService } from "@langwatch/enterprise-api";
import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import type { RoleService } from "@langwatch/role-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import {
  errorCodeOf,
  mountRestFamily,
  TEST_ORGANIZATION_ID,
} from "../../../app-rest/__tests__/support/rest-family.harness";
import { organizationWorld } from "../../../app-rest/__tests__/support/organization-family.world";

/** A plan lookup a test can flip between FREE and ENTERPRISE mid-suite. */
function mutablePlans(initial: string) {
  let planType = initial;
  return {
    set: (next: string) => {
      planType = next;
    },
    plans: () => ({ getActivePlan: async () => ({ type: planType }) }) as never,
  };
}

describe("given a fully-permissioned credential on a plan below Enterprise", () => {
  describe("when the organization API is fetched", () => {
    /** @scenario "The organization API requires an Enterprise plan" */
    it("refuses with 402, naming the feature and the way up", async () => {
      const world = organizationWorld({ planType: "FREE" });

      const response = await world.api.get("/api/v1/organization/latest/", {
        authorization: "Bearer org-key",
      });

      expect(response.status).toBe(402);
      const body = (await response.json()) as {
        code: string;
        meta: { feature: string };
        tips: string[];
        docsUrl: string;
      };
      expect(body.code).toBe("enterprise_plan_required");
      expect(body.meta.feature).toBe("MANAGEMENT_API");
      expect(body.tips.length).toBeGreaterThan(0);
      expect(body.docsUrl).toBeTruthy();
    });
  });

  describe("when custom roles are listed", () => {
    /** @scenario "The roles API requires an Enterprise plan" */
    it("refuses the roles API with 402", async () => {
      const { plans } = mutablePlans("FREE");
      const api = mountRestFamily({
        packaged: { roles: () => ({}) as unknown as RoleService },
        packagedPorts: {
          enterpriseGate: createEnterprisePlanGate({
            organization: (c) => c.get("organization") as { id: string } | undefined,
            plans,
          }),
        },
      });

      const response = await api.fetch("/api/roles/latest/");

      expect(response.status).toBe(402);
      expect(await errorCodeOf(response)).toBe("enterprise_plan_required");
    });
  });

  describe("when role bindings are listed", () => {
    /** @scenario "The role bindings API requires an Enterprise plan" */
    it("refuses the role-bindings API with 402", async () => {
      const { plans } = mutablePlans("FREE");
      const api = mountRestFamily({
        packaged: {
          permissions: () => ({}) as unknown as AuthzService,
          authzGrants: () => ({}) as unknown as AuthzGrantsService,
        },
        packagedPorts: {
          enterpriseGate: createEnterprisePlanGate({
            organization: (c) => c.get("organization") as { id: string } | undefined,
            plans,
          }),
        },
      });

      const response = await api.fetch("/api/role-bindings/latest/");

      expect(response.status).toBe(402);
      expect(await errorCodeOf(response)).toBe("enterprise_plan_required");
    });
  });

  describe("when SCIM tokens are listed", () => {
    /** @scenario "The SCIM tokens API requires an Enterprise plan" */
    it("refuses the SCIM tokens API with 402", async () => {
      const { plans } = mutablePlans("FREE");
      const api = mountRestFamily({
        packaged: {
          scim: () => {
            const scim = inMemoryScim();
            return ScimApp.create({ scim, planProvider: scim });
          },
        },
        packagedPorts: {
          enterpriseGate: createEnterprisePlanGate({
            organization: (c) => c.get("organization") as { id: string } | undefined,
            plans,
          }),
        },
      });

      const response = await api.fetch("/api/v1/scim-tokens");

      expect(response.status).toBe(402);
      expect(await errorCodeOf(response)).toBe("enterprise_plan_required");
    });
  });

  describe("when groups are listed", () => {
    /** @scenario "Group endpoints require an Enterprise plan" */
    it("refuses with 402 and discloses no group", async () => {
      const { plans } = mutablePlans("FREE");
      const listGroups = () => {
        throw new Error("the gate must refuse before the organization service is read");
      };
      const api = mountRestFamily({
        packaged: { organizations: () => ({ listGroups }) as unknown as OrganizationService },
        packagedPorts: {
          enterpriseGate: createEnterprisePlanGate({
            organization: (c) => c.get("organization") as { id: string } | undefined,
            plans,
          }),
        },
      });

      const response = await api.fetch("/api/groups");

      expect(response.status).toBe(402);
      const body = await response.text();
      expect(body).not.toContain("group-");
    });
  });
});

describe("given a SCIM token minted while the organization was on Enterprise", () => {
  describe("when the plan lapses and the identity provider makes a request", () => {
    /** @scenario "A SCIM bearer token stops working when the plan lapses" */
    it("refuses with 403 in the SCIM error format, and provisions nothing", async () => {
      const scim = inMemoryScim("ENTERPRISE");
      const api = mountRestFamily({
        packaged: { scim: () => ScimApp.create({ scim, planProvider: scim }) },
        processPorts: { scim: { scim: () => scim, webhookSecret: undefined } },
      });

      const create = await api.post("/api/v1/scim-tokens", { connectionId: "ssoconn_acme" });
      const { token } = (await create.json()) as { token: string };
      const bearer = { authorization: `Bearer ${token}` };

      expect((await api.get("/api/scim/v2/Users", bearer)).status).toBe(200);

      scim.setPlan("FREE");
      const refused = await api.get("/api/scim/v2/Users", bearer);

      expect(refused.status).toBe(403);
      expect(refused.headers.get("content-type")).toContain("application/scim+json");
      const refusedBody = (await refused.json()) as { schemas: string[]; status: string };
      expect(refusedBody.schemas).toEqual(["urn:ietf:params:scim:api:messages:2.0:Error"]);
      expect(refusedBody.status).toBe("403");

      const email = "never-provisioned@example.com";
      const created = await api.post(
        "/api/scim/v2/Users",
        {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: email,
          name: { givenName: "Never", familyName: "Provisioned" },
          active: true,
        },
        bearer,
      );
      expect(created.status).toBe(403);
    });
  });
});

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

/** The plan lookup `ScimApp` takes, stated structurally as the feature declares it. */
type ScimPlanForOrganization = {
  getActivePlan(input: { organizationId: string }): Promise<{ type: string }>;
};

/**
 * The SCIM directory's own entitlement check runs inside `verifyToken`
 * (`ScimService`, production shape): a token names an organization, and the
 * plan is read fresh on every call rather than at mint time.
 */
function inMemoryScim(
  initialPlan = "ENTERPRISE",
): ScimService & ScimPlanForOrganization & { setPlan(plan: string): void } {
  let plan = initialPlan;
  const tokens = new Map<string, { id: string; hashed: string; connectionId: string | null }>();

  return {
    setPlan: (next: string) => {
      plan = next;
    },
    getActivePlan: async () => ({ type: plan }),
    generateToken: async (input: { connectionId?: string | null; description?: string }) => {
      const token = `scim_${randomUUID()}`;
      const tokenId = `scimtoken_${tokens.size + 1}`;
      tokens.set(tokenId, {
        id: tokenId,
        hashed: digest(token),
        connectionId: input.connectionId ?? null,
      });
      return { token, tokenId, connectionId: input.connectionId ?? null };
    },
    listTokens: async () => [],
    revokeToken: async () => ({ success: true as const }),
    verifyToken: async (input: { token: string }) => {
      const hashed = digest(input.token);
      const found = [...tokens.values()].find((row) => row.hashed === hashed);
      if (!found) return { status: "invalid_token" as const };
      if (plan !== "ENTERPRISE") {
        return { status: "plan_not_entitled" as const, organizationId: TEST_ORGANIZATION_ID };
      }
      return {
        status: "ok" as const,
        organizationId: TEST_ORGANIZATION_ID,
        connectionId: found.connectionId,
      };
    },
    listUsers: async () => ({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: 0,
      startIndex: 1,
      itemsPerPage: 100,
      Resources: [],
    }),
  } as unknown as ScimService & ScimPlanForOrganization & { setPlan(plan: string): void };
}
