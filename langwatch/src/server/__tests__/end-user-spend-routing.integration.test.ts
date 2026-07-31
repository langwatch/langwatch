/**
 * @vitest-environment node
 *
 * The end-user spend path on the COMPOSED router: exactly one surface may
 * own /api/gateway/v1/end-users/:id/spend. The provisioning app once
 * registered the same path project-key-first, which shadowed the billing
 * surface entirely (its own suite passed app-direct while the live router
 * served a different handler with a hardcoded null cap). These tests pin
 * the resolution at the layer the bug lived on: the real router, both key
 * types.
 *
 * The one true shape: the ORG-key billing surface serving the usage
 * rollup PLUS the applicable attributed-user caps. Project keys are not
 * this surface's audience and are refused outright, never silently served
 * a different shape.
 *
 * Spec: specs/ai-gateway/end-user-attribution.feature
 */
import { generate } from "@langwatch/ksuid";
import type { ClickHouseClient } from "@clickhouse/client";
import { OrganizationUserRole, RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Same environment shims the app-direct suite uses: the billing plan gate
// and the ClickHouse resolution, both pointed at the test substrate.
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    planProvider: {
      getActivePlan: async () => ({ webhookEndpointsEnabled: true }),
    },
  }),
}));
let chClient: ClickHouseClient;
vi.mock("~/server/clickhouse/clickhouseClient", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("~/server/clickhouse/clickhouseClient")
    >();
  return {
    ...original,
    getClickHouseClientForProject: async () => chClient,
  };
});

import { ApiKeyService } from "~/server/api-key/api-key.service";
import { KSUID_RESOURCES } from "~/utils/constants";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";

const suffix = nanoid(8);
const ORG_ID = `org-eusr-${suffix}`;
const TEAM_ID = `team-eusr-${suffix}`;
const PROJECT_ID = `proj-eusr-${suffix}`;
const USER_ID = `usr-eusr-${suffix}`;
const PROJECT_KEY = `legacy-eusr-${suffix}`;

describe("end-user spend on the composed router", () => {
  let orgKeyToken: string;
  let router: { request: (input: string, init?: RequestInit) => Promise<Response> };
  let routes: Array<{ method: string; path: string }>;

  beforeAll(async () => {
    await startTestContainers();
    const { getTestClickHouseClient } = await import(
      "~/server/event-sourcing/__tests__/integration/testContainers"
    );
    const client = getTestClickHouseClient();
    if (!client) throw new Error("test ClickHouse client unavailable");
    chClient = client;
    await prisma.organization.create({
      data: { id: ORG_ID, name: `EUSR ${suffix}`, slug: `eusr-${suffix}` },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `EUSR Team ${suffix}`,
        slug: `eusr-team-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: `EUSR Project ${suffix}`,
        slug: `eusr-proj-${suffix}`,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: PROJECT_KEY,
      },
    });
    await prisma.user.create({
      data: { id: USER_ID, email: `${suffix}@eusr.local`, name: "Op" },
    });
    await prisma.organizationUser.create({
      data: {
        userId: USER_ID,
        organizationId: ORG_ID,
        role: OrganizationUserRole.ADMIN,
      },
    });
    await prisma.roleBinding.create({
      data: {
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId: ORG_ID,
        userId: USER_ID,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: ORG_ID,
      },
    });
    const created = await ApiKeyService.create(prisma).create({
      name: `eusr-${suffix}`,
      userId: USER_ID,
      createdByUserId: USER_ID,
      organizationId: ORG_ID,
      permissionMode: "all",
      bindings: [
        {
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: ORG_ID,
        },
      ],
    });
    orgKeyToken = created.token;

    const { createApiRouter } = await import("~/server/api-router");
    const built = createApiRouter();
    router = built as unknown as typeof router;
    routes = (built as unknown as { routes: Array<{ method: string; path: string }> })
      .routes;
  }, 120_000);

  afterAll(async () => {
    if (!ORG_ID) return;
    await prisma.roleBinding.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.apiKey.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.organizationUser.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await stopTestContainers();
  });

  it("registers the path on exactly one surface", () => {
    // Hono's route table carries one entry per middleware layer, so the
    // count varies with the guard chain; what must be single is the PATH
    // SHAPE. The shadow bug registered the same resource under two param
    // spellings (:end_user_id on one app, :id on the other), so two
    // distinct path strings is exactly the regression signature.
    const paths = new Set(
      routes
        .filter(
          (r) =>
            r.method === "GET" &&
            /\/api\/gateway\/v1\/end-users\/:[^/]+\/spend$/.test(r.path),
        )
        .map((r) => r.path),
    );
    expect([...paths]).toEqual(["/api/gateway/v1/end-users/:id/spend"]);
  });

  /** @scenario The end-user spend endpoint returns spend and the applicable cap together */
  it("serves the org-key caller the rollup with caps through the real router", async () => {
    const res = await router.request(
      `http://localhost/api/gateway/v1/end-users/router-user-${suffix}/spend`,
      { headers: { Authorization: `Bearer ${orgKeyToken}` } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { end_user_id: string; caps: unknown[]; cost: { nano_usd: number } };
    };
    expect(body.data.end_user_id).toBe(`router-user-${suffix}`);
    expect(Array.isArray(body.data.caps)).toBe(true);
    expect(body.data.cost.nano_usd).toBe(0);
  });

  it("refuses a project key rather than serving a different shape", async () => {
    const res = await router.request(
      `http://localhost/api/gateway/v1/end-users/router-user-${suffix}/spend`,
      { headers: { "X-Auth-Token": PROJECT_KEY } },
    );
    expect(res.status).toBe(401);
  });
});
