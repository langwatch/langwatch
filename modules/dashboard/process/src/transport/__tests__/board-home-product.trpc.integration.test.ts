/**
 * @vitest-environment node
 * A board's home product on the real tRPC runtime, application and memory repositories: made
 * with one, refused at Project outside LLM Ops, and moved (ADR-002, decision 8).
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */
import { createTrpcRuntime, TrpcRootDefinition } from "@langwatch/api/trpc";
import type { DashboardScope } from "@langwatch/dashboard-contract";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";

import {
  createDashboardTestApp,
  createDashboardTestAuthz,
  createDashboardTestProjects,
} from "../../app/__tests__/dashboard.fixture.ts";
import { MemoryDashboardRepositories } from "../../repositories/memory/memory.dashboard.repositories.ts";
import { boardTrpcTransport } from "../board.trpc.ts";

type TestContext = { actor: { id: string } };

const ACME = "organization-acme";
const SHOP = "project-shop";
const OPS = "project-ops";
const AUTHOR = "member-author";
const TEAMMATE = "member-teammate";
const EDITOR = ["organization:view", "analytics:view", "analytics:create", "analytics:update"];
const VIEWER = ["organization:view", "analytics:view"];

/** Shop and Ops in Acme; every member holds `permissions` in both, at the door and in services. */
function world({ permissions = EDITOR }: { permissions?: readonly string[] } = {}) {
  const repositories = MemoryDashboardRepositories.create();
  const app = createDashboardTestApp({
    repositories,
    dependencies: {
      projects: createDashboardTestProjects({ organizations: { [SHOP]: ACME, [OPS]: ACME } }),
      authz: createDashboardTestAuthz({ permissions }),
    },
  });
  const trpc = TrpcRootDefinition.forContext<TestContext>().create();
  const runtime = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<TestContext>({
      permits: (permission) => permissions.includes(permission),
    }),
  }).mount(boardTrpcTransport, () => app);
  const as = (userId: string) => runtime.createCaller({ actor: { id: userId } });

  /** A board in Shop by the author, stored as a board of that scope and home already is. */
  const board = async ({
    scope,
    homeProduct = "llm-ops",
  }: {
    scope: DashboardScope;
    homeProduct?: "llm-ops" | "gateway";
  }) =>
    repositories.boards.createBoard({
      id: `board-${scope}-${homeProduct}`,
      projectId: SHOP,
      name: `${scope} board`,
      createdById: AUTHOR,
      scope,
      homeProduct,
      organizationId: scope === "ORGANIZATION" ? ACME : null,
    });
  const stored = async (dashboardId: string) => {
    const [row] = await repositories.boards.findBoardsByIds({
      projectId: SHOP,
      dashboardIds: [dashboardId],
    });
    return row;
  };
  const storedInShop = () => repositories.boards.findBoardsInProjects({ projectIds: [SHOP] });
  return { as, board, stored, storedInShop };
}

async function codeOf(answer: Promise<unknown>): Promise<string | undefined> {
  const refused = await answer.then(
    () => expect.fail("the call was answered"),
    (error: { cause?: { code?: string } }) => error,
  );
  return refused.cause?.code;
}

describe("a board's home product", () => {
  describe("given a member who may create and edit in Shop", () => {
    /** @scenario "A board outside LLM Ops cannot be Project" */
    it("refuses a Project board outside LLM Ops by either create, and makes nothing", async () => {
      const { as, storedInShop } = world();
      const author = as(AUTHOR);

      const refused = await Promise.all([
        codeOf(author.create({ projectId: SHOP, name: "Spend", homeProduct: "gateway" })),
        codeOf(
          author.createAtScope({
            projectId: SHOP,
            name: "Spend",
            scope: "PROJECT",
            homeProduct: "governance",
          }),
        ),
      ]);

      expect(refused).toEqual(["dashboard_home_needs_org_scope", "dashboard_home_needs_org_scope"]);
      expect(await storedInShop()).toEqual([]);
    });

    /** @scenario "A board outside LLM Ops cannot be Project" */
    it("makes an Organization board in Gateway, and lists it there everywhere", async () => {
      const { as } = world();
      const author = as(AUTHOR);

      const made = await author.createAtScope({
        projectId: SHOP,
        name: "Spend",
        scope: "ORGANIZATION",
        homeProduct: "gateway",
      });
      const plain = await author.create({ projectId: SHOP, name: "Latency" });
      const library = await author.listInOrganization({ organizationId: ACME });
      const inShop = await author.getAll({ projectId: SHOP });

      expect([made.homeProduct, plain.homeProduct]).toEqual(["gateway", "llm-ops"]);
      expect(library.map(({ name, homeProduct }) => [name, homeProduct])).toEqual([
        ["Spend", "gateway"],
        ["Latency", "llm-ops"],
      ]);
      expect(inShop.map(({ name, homeProduct }) => [name, homeProduct])).toEqual([
        ["Spend", "gateway"],
        ["Latency", "llm-ops"],
      ]);
    });

    /** @scenario "A scope change to Project is refused outside LLM Ops" */
    it("refuses its author a scope change to Project outside LLM Ops, and keeps the scope", async () => {
      const { as, board, stored } = world();
      const shared = await board({ scope: "ORGANIZATION", homeProduct: "gateway" });

      const refused = await codeOf(
        as(AUTHOR).setScope({ projectId: SHOP, dashboardId: shared.id, scope: "PROJECT" }),
      );

      expect(refused).toBe("dashboard_home_needs_org_scope");
      expect((await stored(shared.id))?.scope).toBe("ORGANIZATION");
    });

    /** @scenario "Moving a board changes its home only" */
    it("moves an Organization board to Gateway and answers it as the library lists it", async () => {
      const { as, board, stored } = world();
      const shared = await board({ scope: "ORGANIZATION" });
      const author = as(AUTHOR);

      const moved = await author.move({
        projectId: SHOP,
        dashboardId: shared.id,
        homeProduct: "gateway",
      });
      const resolved = await author.resolve({ organizationId: ACME, dashboardId: shared.id });

      expect(moved).toMatchObject({
        id: shared.id,
        homeProduct: "gateway",
        scope: "ORGANIZATION",
        project: { id: SHOP },
      });
      expect(resolved.homeProduct).toBe("gateway");
      expect(await stored(shared.id)).toMatchObject({ projectId: SHOP, scope: "ORGANIZATION" });
    });

    /** @scenario "Moving a board changes its home only" */
    it("keeps an Only me board Only me, and an Organization board Organization back in LLM Ops", async () => {
      const { as, board } = world();
      const mine = await board({ scope: "PRIVATE" });
      const shared = await board({ scope: "ORGANIZATION", homeProduct: "gateway" });
      const author = as(AUTHOR);

      const movedMine = await author.move({
        projectId: SHOP,
        dashboardId: mine.id,
        homeProduct: "governance",
      });
      const backHome = await author.move({
        projectId: SHOP,
        dashboardId: shared.id,
        homeProduct: "llm-ops",
      });

      expect([movedMine.scope, movedMine.homeProduct]).toEqual(["PRIVATE", "governance"]);
      expect([backHome.scope, backHome.homeProduct]).toEqual(["ORGANIZATION", "llm-ops"]);
    });

    /** @scenario "Only the author can move a Project board out of LLM Ops" */
    it("makes the author's Project board Only me when they move it out of LLM Ops", async () => {
      const { as, board, stored } = world();
      const ours = await board({ scope: "PROJECT" });

      const moved = await as(AUTHOR).move({
        projectId: SHOP,
        dashboardId: ours.id,
        homeProduct: "me",
      });

      expect([moved.scope, moved.homeProduct]).toEqual(["PRIVATE", "me"]);
      expect(await stored(ours.id)).toMatchObject({ projectId: SHOP, scope: "PRIVATE" });
    });

    /** @scenario "Only the author can move a Project board out of LLM Ops" */
    it("refuses a teammate's move of a Project board out of LLM Ops, and changes nothing", async () => {
      const { as, board, stored } = world();
      const ours = await board({ scope: "PROJECT" });

      const refused = await codeOf(
        as(TEAMMATE).move({ projectId: SHOP, dashboardId: ours.id, homeProduct: "gateway" }),
      );
      const fromOps = await as(AUTHOR).getAll({ projectId: OPS, includeOrganization: true });

      expect(refused).toBe("dashboard_scope_author_only");
      expect(await stored(ours.id)).toMatchObject({
        scope: "PROJECT",
        homeProduct: "llm-ops",
        organizationId: null,
      });
      expect(fromOps).toEqual([]);
    });
  });

  describe("given a move the member may not make", () => {
    /** @scenario "The server refuses a move without edit rights in the owning project" */
    it("refuses a member who may only view dashboards, and the home is unchanged", async () => {
      const { as, board, stored } = world({ permissions: VIEWER });
      const shared = await board({ scope: "ORGANIZATION" });

      const refused = await codeOf(
        as(AUTHOR).move({ projectId: SHOP, dashboardId: shared.id, homeProduct: "gateway" }),
      );

      expect(refused).toBe("permission_denied");
      expect((await stored(shared.id))?.homeProduct).toBe("llm-ops");
    });

    /** @scenario "The server refuses a move without edit rights in the owning project" */
    it("refuses a move named from another project, and another member's Only me board", async () => {
      const { as, board, stored } = world();
      const shared = await board({ scope: "ORGANIZATION" });
      const mine = await board({ scope: "PRIVATE" });

      const refused = await Promise.all([
        codeOf(as(AUTHOR).move({ projectId: OPS, dashboardId: shared.id, homeProduct: "gateway" })),
        codeOf(
          as(TEAMMATE).move({ projectId: SHOP, dashboardId: mine.id, homeProduct: "gateway" }),
        ),
      ]);

      expect(refused).toEqual(["dashboard_read_only_here", "dashboard_not_found"]);
      expect([
        (await stored(shared.id))?.homeProduct,
        (await stored(mine.id))?.homeProduct,
      ]).toEqual(["llm-ops", "llm-ops"]);
    });
  });
});
