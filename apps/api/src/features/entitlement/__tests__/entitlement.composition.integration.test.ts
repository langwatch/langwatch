/**
 * What a plan allows and what has been used against it, served by the API process.
 */
import type { AgentApi } from "@langwatch/agent-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import type { UsageUnit } from "@langwatch/entitlement-contract";
import { UsageCounter, UsageWarning } from "@langwatch/entitlement-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";
import { ApiApplication } from "../../../api.application.ts";
import { ApiTrpcFeaturesComposition } from "../../../app/api-trpc-features.composition.ts";
import {
  stubCollaborators,
  stubComposedFeatures,
  stubInfrastructureEntitlements,
} from "../../../app/__tests__/api-trpc-record.test-doubles.ts";
import { composeApiPlanSources } from "../../../app/api-usage.composition.ts";
import { installApiEntitlement } from "../entitlement.composition.ts";

const SESSION_USER = { id: "user-1", name: "Sam Rivers", email: "sam@acme.test", role: "ADMIN" };
const ORGANIZATION_ID = "organization-1";

/** The month's volume, as the reading asks for it. */
class TestUsageCounter implements UsageCounter {
  async getCurrentMonthCountForDisplay(): Promise<number> {
    return 1_234;
  }

  async getResolvedUsageUnit(): Promise<UsageUnit> {
    return "traces";
  }
}

/** The approaching-limit mail, recorded rather than delivered. */
class TestUsageWarnings implements UsageWarning {
  async sendWarning(): Promise<{ sent: boolean }> {
    return { sent: false };
  }
}

/**
 * The rows the reading and the spend rollup read: one project, no members and
 * no recorded cost.
 */
function testPrisma(): PrismaClient {
  const answers: Record<string, Record<string, unknown>> = {
    project: { findMany: [{ id: "project-1", name: "Checkout" }], findUnique: null },
    organization: { findUnique: { pricingModel: null } },
    organizationUser: { findMany: [] },
    organizationInvite: { findMany: [] },
    customRole: { findMany: [] },
    team: { findMany: [] },
    roleBinding: { findMany: [] },
    cost: { aggregate: { _sum: { amount: null } }, groupBy: [] },
  };

  return new Proxy(
    {},
    {
      get: (_target, model) =>
        new Proxy(
          {},
          {
            get: (_inner, method) => async () => {
              const forModel = answers[String(model)];
              if (!forModel || !(String(method) in forModel)) return null;
              return forModel[String(method)];
            },
          },
        ),
      has: () => true,
    },
  ) as unknown as PrismaClient;
}

function testAuthz(): AuthzService {
  return { hasPermission: async () => true } as unknown as AuthzService;
}

async function composeApplication() {
  const infrastructure = {
    ...stubInfrastructureEntitlements(),
    prisma: testPrisma(),
    authz: testAuthz(),
    audit: undefined,
  };
  const entitlement = await installApiEntitlement({
    infrastructure,
    entitlement: {
      ...composeApiPlanSources({ isSaas: false }),
      counter: new TestUsageCounter(),
      warnings: new TestUsageWarnings(),
    },
    peers: { users: createApiFixture<UserApi>({ tryFindById: async () => null }) },
  });

  const features = ApiTrpcFeaturesComposition.tryCompose({
    composed: { ...stubComposedFeatures(), entitlement },
    infrastructure,
    collaborators: stubCollaborators({ planProvider: entitlement.app }),
  });
  if (!features) throw new Error("the record refused to compose against its collaborators");

  return ApiApplication.create({
    agents: createApiFixture<AgentApi>(),
    features,
    http: {
      createContext: async () => ({
        actor: () => ({ id: SESSION_USER.id }),
        tryActor: () => ({ id: SESSION_USER.id }),
        authorize: async () => undefined,
        session: { user: SESSION_USER },
      }),
    },
  });
}

async function callTrpc(
  application: ApiApplication,
  path: string,
  input: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  if (!application.hono) throw new Error("HTTP composition was not created.");

  const response = await application.hono.request(
    `http://127.0.0.1/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`,
  );

  return { status: response.status, body: await response.json() };
}

describe("given an API process composed with the entitlement feature", () => {
  describe("when the usage panel is read through the mounted namespace", () => {
    it("answers the month's volume off the counter the process installed", async () => {
      const application = await composeApplication();

      const { status, body } = await callTrpc(application, "limits.getUsage", {
        organizationId: ORGANIZATION_ID,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({
        result: { data: { currentMonthMessagesCount: 1_234 } },
      });
    });
  });

  describe("when the plan banner reads the same organization", () => {
    it("answers off the SAME application the usage panel read", async () => {
      const application = await composeApplication();

      const { status, body } = await callTrpc(application, "plan.getActivePlan", {
        organizationId: ORGANIZATION_ID,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({ result: { data: { name: expect.any(String) } } });
    });
  });
});
