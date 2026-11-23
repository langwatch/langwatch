/**
 * @vitest-environment node
 * `boards.resolve`, a board of the organization by id for the org-level board pages, on the real
 * tRPC runtime over the real dashboard application and memory repositories.
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
} from "../../app/__tests__/dashboard.fixture.ts";
import { MemoryDashboardRepositories } from "../../repositories/memory/memory.dashboard.repositories.ts";
import { boardTrpcTransport } from "../board.trpc.ts";

type TestContext = { actor: { id: string } };

const ACME = "organization-acme";
const BETA = "organization-beta";
const SHOP = "project-shop";
const OPS = "project-ops";
const BETA_PROJECT = "project-beta";
const ME = "member-me";

/** Acme's two projects and another organization's, the seat's readable ones and those off. */
async function organization({
  readable,
  dashboardsOffIn = [],
}: {
  readable: readonly string[];
  dashboardsOffIn?: readonly string[];
}) {
  const repositories = MemoryDashboardRepositories.create();
  const app = createDashboardTestApp({
    repositories,
    dependencies: {
      analytics: createDashboardTestAnalytics({
        isDashboardsEnabled: async ({ projectId }) => !dashboardsOffIn.includes(projectId),
      }),
      projects: createDashboardTestProjects({
        organizations: { [SHOP]: ACME, [OPS]: ACME, [BETA_PROJECT]: BETA },
      }),
      authz: createDashboardTestAuthz({ openProjectIds: readable }),
    },
  });
  const board = async ({
    projectId,
    name,
    scope = "PROJECT",
  }: {
    projectId: string;
    name: string;
    scope?: DashboardScope;
  }) => {
    const id = `board-${name}`;
    await repositories.boards.createBoard({ id, projectId, name, createdById: ME, scope });
    if (scope !== "ORGANIZATION") return id;
    const organizationId = projectId === BETA_PROJECT ? BETA : ACME;
    await repositories.boards.updateBoard({ projectId, dashboardId: id, data: { organizationId } });
    return id;
  };
  const trpc = TrpcRootDefinition.forContext<TestContext>().create();
  const caller = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<TestContext>({
      permits: (permission) => permission === "organization:view",
    }),
  })
    .mount(boardTrpcTransport, () => app)
    .createCaller({ actor: { id: ME } });
  const resolve = (dashboardId: string) => caller.resolve({ organizationId: ACME, dashboardId });

  return { board, resolve };
}

/** The refusal as the wire carries it, for comparing two answers and searching its text. */
async function refusalOf(answer: Promise<unknown>) {
  const error = await answer.then(
    () => expect.fail("resolve answered a board"),
    (refused: { message: string; cause?: { code?: string; meta?: unknown } }) => refused,
  );
  const { code, meta } = error.cause ?? {};
  return { code, meta, text: JSON.stringify({ message: error.message, meta }) };
}

describe("resolving a board of the organization by id", () => {
  describe("given a Project board of a project the member reads", () => {
    /** @scenario "A Project board opens at its org-level address" */
    it("answers its scope and names its project, opening it in place", async () => {
      const { board, resolve } = await organization({ readable: [SHOP, OPS] });
      const id = await board({ projectId: SHOP, name: "Shop board" });

      const resolved = await resolve(id);

      expect(resolved).toMatchObject({ id, scope: "PROJECT", project: { id: SHOP } });
    });
  });

  describe("given a Project board of a project the member cannot read", () => {
    /** @scenario "A Project board of a project I cannot read is not available at org level" */
    it("answers not found, naming no project", async () => {
      const { board, resolve } = await organization({ readable: [SHOP] });
      const id = await board({ projectId: OPS, name: "Ops board" });

      const refusal = await refusalOf(resolve(id));

      expect(refusal.code).toBe("dashboard_not_found");
      expect(refusal.text).not.toContain(OPS);
    });
  });

  describe("given an Organization board whose project the member cannot read", () => {
    it("answers it with no project named, opening in a project the member reads", async () => {
      const { board, resolve } = await organization({ readable: [SHOP] });
      const id = await board({ projectId: OPS, name: "For everyone", scope: "ORGANIZATION" });

      const resolved = await resolve(id);

      expect(resolved).toMatchObject({ project: null, openProject: { id: SHOP } });
    });
  });

  describe("given a board of another organization", () => {
    /** @scenario "A board of another organization is not found by id" */
    it("answers exactly as for a board that does not exist", async () => {
      const { board, resolve } = await organization({ readable: [SHOP, OPS, BETA_PROJECT] });
      const id = await board({ projectId: BETA_PROJECT, name: "Beta", scope: "ORGANIZATION" });

      const elsewhere = await refusalOf(resolve(id));
      const missing = await refusalOf(resolve("board-never-made"));

      expect(elsewhere.code).toBe("dashboard_not_found");
      expect({ code: elsewhere.code, meta: elsewhere.meta }).toEqual({
        code: missing.code,
        meta: missing.meta,
      });
    });
  });

  describe("given a project of the organization with Dashboards off", () => {
    /** @scenario "Boards of a project with Dashboards off are not in the organization's area" */
    it("resolves no board that project owns, its Organization boards included", async () => {
      const { board, resolve } = await organization({
        readable: [SHOP, OPS],
        dashboardsOffIn: [OPS],
      });
      const projectBoard = await board({ projectId: OPS, name: "Ops board" });
      const forEveryone = await board({ projectId: OPS, name: "Ops all", scope: "ORGANIZATION" });

      expect((await refusalOf(resolve(projectBoard))).code).toBe("dashboard_not_found");
      expect((await refusalOf(resolve(forEveryone))).code).toBe("dashboard_not_found");
    });
  });
});
