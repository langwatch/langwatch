/**
 * @vitest-environment node
 * A member's own order of a product sidebar's Dashboards section, on the real tRPC runtime,
 * application and memory repositories: kept per member, organization and product.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */
import { createTrpcRuntime, TrpcRootDefinition } from "@langwatch/api/trpc";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createDashboardTestApp,
  createDashboardTestAuthz,
  createDashboardTestProjects,
} from "../../app/__tests__/dashboard.fixture.ts";
import { MemoryDashboardRepositories } from "../../repositories/memory/memory.dashboard.repositories.ts";
import { boardTrpcTransport } from "../board.trpc.ts";

type TestContext = { actor: { id: string } };

const ACME = "organization-acme";
const GLOBEX = "organization-globex";
const MEMBER = "member-one";
const TEAMMATE = "member-two";
/** Only what the order needs: seeing the organization, no grant to edit any board. */
const VIEWS_ORGANIZATION = ["organization:view"];

function world() {
  const repositories = MemoryDashboardRepositories.create();
  const app = createDashboardTestApp({
    repositories,
    dependencies: {
      projects: createDashboardTestProjects({ organizations: { "project-shop": ACME } }),
      authz: createDashboardTestAuthz({ permissions: VIEWS_ORGANIZATION }),
    },
  });
  const trpc = TrpcRootDefinition.forContext<TestContext>().create();
  const runtime = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<TestContext>({
      permits: (permission) => VIEWS_ORGANIZATION.includes(permission),
    }),
  }).mount(boardTrpcTransport, () => app);
  return { as: (userId: string) => runtime.createCaller({ actor: { id: userId } }) };
}

/** The tRPC code a refused call answers with; a malformed input is BAD_REQUEST. */
async function codeOf(answer: Promise<unknown>): Promise<string | undefined> {
  const refused = await answer.then(
    () => expect.fail("the call was answered"),
    (error: { code?: string }) => error,
  );
  return refused.code;
}

describe("a member's sidebar order", () => {
  const llmOps = { organizationId: ACME, homeProduct: "llm-ops" } as const;
  let as: ReturnType<typeof world>["as"];
  let member: ReturnType<ReturnType<typeof world>["as"]>;

  beforeEach(() => {
    as = world().as;
    member = as(MEMBER);
  });

  /** @scenario "The sidebar order is stored per member, organization and product" */
  it("answers the saved order to its member only, leaving other products and organizations", async () => {
    expect(await member.sidebarOrder(llmOps)).toEqual({ dashboardIds: [] });
    expect(await member.reorderSidebar({ ...llmOps, dashboardIds: ["gamma", "alpha"] })).toEqual({
      success: true,
    });
    await member.reorderSidebar({ ...llmOps, dashboardIds: ["gamma", "alpha", "beta"] });

    expect(await member.sidebarOrder(llmOps)).toEqual({ dashboardIds: ["gamma", "alpha", "beta"] });
    expect(await as(TEAMMATE).sidebarOrder(llmOps)).toEqual({ dashboardIds: [] });
    expect(await member.sidebarOrder({ ...llmOps, homeProduct: "gateway" })).toEqual({
      dashboardIds: [],
    });
    expect(await member.sidebarOrder({ ...llmOps, organizationId: GLOBEX })).toEqual({
      dashboardIds: [],
    });
  });

  /** @scenario "The sidebar order is stored per member, organization and product" */
  it("refuses an order of more than 500 boards or one naming a board twice, storing nothing", async () => {
    const tooMany = Array.from({ length: 501 }, (_, index) => `board-${index}`);

    const refused = await Promise.all([
      codeOf(member.reorderSidebar({ ...llmOps, dashboardIds: tooMany })),
      codeOf(member.reorderSidebar({ ...llmOps, dashboardIds: ["alpha", "beta", "alpha"] })),
    ]);

    expect(refused).toEqual(["BAD_REQUEST", "BAD_REQUEST"]);
    expect(await member.sidebarOrder(llmOps)).toEqual({ dashboardIds: [] });
  });
});
