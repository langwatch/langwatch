/**
 * @vitest-environment node
 * The library's procedures on the real tRPC runtime, application and memory repositories.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */
import { createTrpcRuntime, TrpcRootDefinition } from "@langwatch/api/trpc";
import type { DashboardScope } from "@langwatch/dashboard-contract";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";

import {
  createDashboardTestAnalytics,
  createDashboardTestApp,
  createDashboardTestAuthz,
  createDashboardTestProjects,
  createDashboardTestUsers,
} from "../../app/__tests__/dashboard.fixture.ts";
import { MemoryDashboardRepositories } from "../../repositories/memory/memory.dashboard.repositories.ts";
import { boardTrpcTransport } from "../board.trpc.ts";

type TestContext = { actor: { id: string } };

const ACME = "organization-acme";
const SHOP = "project-shop";
const OPS = "project-ops";
const PERSONAL = "project-personal";
/** Not among the organization's live projects, as an archived one is not. */
const ARCHIVED = "project-archived";
const ME = "member-me";
const SOMEONE = "member-someone";
/** A member whose profile has no name. */
const UNNAMED = "member-unnamed";

/** A world of three projects, the seat's readable ones and those with Dashboards off. */
async function library({
  readable,
  dashboardsOffIn = [],
  personalOwners,
}: {
  readable: readonly string[];
  dashboardsOffIn?: readonly string[];
  personalOwners?: Readonly<Record<string, string>>;
}) {
  const repositories = MemoryDashboardRepositories.create();
  const app = createDashboardTestApp({
    repositories,
    dependencies: {
      analytics: createDashboardTestAnalytics({
        isDashboardsEnabled: async ({ projectId }) => !dashboardsOffIn.includes(projectId),
      }),
      projects: createDashboardTestProjects({
        organizations: { [SHOP]: ACME, [OPS]: ACME, [PERSONAL]: ACME },
        personalOwners,
      }),
      authz: createDashboardTestAuthz({ openProjectIds: readable }),
      users: createDashboardTestUsers({ [SOMEONE]: "Sam Rivera", [UNNAMED]: null }),
    },
  });
  const board = async ({
    projectId,
    name,
    scope = "PROJECT",
    createdById = SOMEONE,
  }: {
    projectId: string;
    name: string;
    scope?: DashboardScope;
    createdById?: string;
  }) => {
    const made = await repositories.boards.createBoard({
      id: `board-${name}`,
      projectId,
      name,
      createdById,
      scope,
    });
    if (scope !== "ORGANIZATION") return made;
    return repositories.boards.updateBoard({
      projectId,
      dashboardId: made.id,
      data: { organizationId: ACME },
    });
  };
  const trpc = TrpcRootDefinition.forContext<TestContext>().create();
  // The seat holds the organization floor and nothing else at the organization tier.
  const caller = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<TestContext>({
      permits: (permission) => permission === "organization:view",
    }),
  })
    .mount(boardTrpcTransport, () => app)
    .createCaller({ actor: { id: ME } });

  return { board, caller };
}

/** Each listed board as the library names it: its name and the project named as owner. */
const named = (rows: readonly { name: string; project: { id: string } | null }[]) =>
  rows.map((row) => [row.name, row.project?.id ?? null]);

describe("the organization's Dashboards library", () => {
  describe("given a Developer seat that reads only its own personal project", () => {
    /** @scenario "A Developer seat can open the library" */
    it("answers, listing its own project's boards and the Organization boards", async () => {
      const { board, caller } = await library({ readable: [PERSONAL] });
      await board({ projectId: PERSONAL, name: "Personal project board" });
      await board({ projectId: PERSONAL, name: "My own", scope: "PRIVATE", createdById: ME });
      await board({ projectId: PERSONAL, name: "Their own", scope: "PRIVATE" });
      await board({ projectId: SHOP, name: "Shop board" });
      await board({ projectId: OPS, name: "Ops board" });
      await board({ projectId: SHOP, name: "Shop for everyone", scope: "ORGANIZATION" });

      const rows = await caller.listInOrganization({ organizationId: ACME });

      expect(named(rows)).toEqual([
        ["Personal project board", PERSONAL],
        ["My own", PERSONAL],
        ["Shop for everyone", null],
      ]);
      expect(rows.find((row) => row.name === "Shop for everyone")?.openProject?.id).toBe(PERSONAL);
    });
  });

  describe("given boards the member may not see", () => {
    /** @scenario "The library leaves out what I may not see" */
    it("lists none of them, and an unreadable project's Organization board unnamed", async () => {
      const { board, caller } = await library({ readable: [SHOP], dashboardsOffIn: [PERSONAL] });
      await board({ projectId: SHOP, name: "Someone's own", scope: "PRIVATE" });
      await board({ projectId: OPS, name: "Ops board" });
      await board({ projectId: PERSONAL, name: "Switched off", scope: "ORGANIZATION" });
      await board({ projectId: ARCHIVED, name: "Archived", scope: "ORGANIZATION" });
      await board({ projectId: OPS, name: "Ops for everyone", scope: "ORGANIZATION" });

      const rows = await caller.listInOrganization({ organizationId: ACME });

      expect(named(rows)).toEqual([["Ops for everyone", null]]);
    });
  });

  describe("given a member who reads no project of the organization", () => {
    it("lists nothing, an Organization board included, since none could open", async () => {
      const { board, caller } = await library({ readable: [] });
      await board({ projectId: SHOP, name: "Shop for everyone", scope: "ORGANIZATION" });

      await expect(caller.listInOrganization({ organizationId: ACME })).resolves.toEqual([]);
    });
  });

  describe("given where a member may store a board made outside a project view", () => {
    it("names the projects they may create in that have Dashboards on, by name", async () => {
      const { caller } = await library({ readable: [SHOP, OPS], dashboardsOffIn: [OPS] });

      const projects = await caller.storeProjects({ organizationId: ACME });

      expect(projects.map((project) => project.id)).toEqual([SHOP]);
    });

    /** @scenario "A board is never stored in another member's personal project" */
    it("leaves out another member's personal project, and keeps the member's own", async () => {
      const { caller } = await library({
        readable: [SHOP, OPS, PERSONAL],
        personalOwners: { [OPS]: ME, [PERSONAL]: SOMEONE },
      });

      const projects = await caller.storeProjects({ organizationId: ACME });

      expect(projects.map((project) => project.id).toSorted()).toEqual([OPS, SHOP]);
    });
  });

  describe("given a project of the organization with Dashboards off", () => {
    /** @scenario "Boards of a project with Dashboards off are not in the organization's area" */
    it("lists no board that project owns, its Organization boards included", async () => {
      const { board, caller } = await library({
        readable: [SHOP, OPS, PERSONAL],
        dashboardsOffIn: [OPS],
      });
      await board({ projectId: SHOP, name: "Shop board" });
      await board({ projectId: OPS, name: "Ops board" });
      await board({ projectId: OPS, name: "Ops for everyone", scope: "ORGANIZATION" });

      const rows = await caller.listInOrganization({ organizationId: ACME });

      expect(named(rows)).toEqual([["Shop board", SHOP]]);
    });
  });

  describe("given Dashboards off in every project of the organization", () => {
    /** @scenario "Dashboards off in every project" */
    it("refuses the library as not enabled", async () => {
      const { board, caller } = await library({
        readable: [SHOP, OPS, PERSONAL],
        dashboardsOffIn: [SHOP, OPS, PERSONAL],
      });
      await board({ projectId: SHOP, name: "Shop board" });

      await expect(caller.listInOrganization({ organizationId: ACME })).rejects.toMatchObject({
        cause: { code: "dashboards_not_enabled" },
      });
    });
  });

  describe("given Dashboards off in every project the member reads, but on in another", () => {
    it("refuses the library as not enabled, since no Organization board could open", async () => {
      const { board, caller } = await library({ readable: [SHOP], dashboardsOffIn: [SHOP] });
      await board({ projectId: OPS, name: "Ops for everyone", scope: "ORGANIZATION" });

      await expect(caller.listInOrganization({ organizationId: ACME })).rejects.toMatchObject({
        cause: { code: "dashboards_not_enabled" },
      });
    });
  });

  describe("given boards by authors with and without a name", () => {
    it("names each board's author, and none where the author has no name", async () => {
      const { board, caller } = await library({ readable: [SHOP] });
      await board({ projectId: SHOP, name: "Named" });
      await board({ projectId: SHOP, name: "Unnamed", createdById: UNNAMED });

      const rows = await caller.listInOrganization({ organizationId: ACME });

      expect(rows.map((row) => [row.name, row.ownerName])).toEqual([
        ["Named", "Sam Rivera"],
        ["Unnamed", null],
      ]);
    });
  });

  describe("given an Organization board of a project the member cannot read", () => {
    it("names no author for it, by name or by id, as it names no project", async () => {
      const { board, caller } = await library({ readable: [SHOP] });
      await board({ projectId: OPS, name: "Ops for everyone", scope: "ORGANIZATION" });
      await board({ projectId: OPS, name: "Ops of mine", scope: "ORGANIZATION", createdById: ME });

      const rows = await caller.listInOrganization({ organizationId: ACME });

      expect(rows.map((row) => [row.name, row.project, row.ownerName, row.createdById])).toEqual([
        ["Ops for everyone", null, null, null],
        ["Ops of mine", null, null, ME],
      ]);
    });
  });
});
