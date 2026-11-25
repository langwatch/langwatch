/**
 * @vitest-environment node
 * A board's icon on the real tRPC runtime, application and memory repositories: set on create,
 * changed and reset by `boards.update`, listed, and refused when off the allow-list.
 * @see modules/dashboard/specs/dashboard-icons.feature
 */
import { createTrpcRuntime, TrpcRootDefinition } from "@langwatch/api/trpc";
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

const SHOP = "project-shop";
const AUTHOR = "member-author";
const EDITOR = ["organization:view", "analytics:view", "analytics:create", "analytics:update"];

function world() {
  const app = createDashboardTestApp({
    repositories: MemoryDashboardRepositories.create(),
    dependencies: {
      projects: createDashboardTestProjects({ organizations: { [SHOP]: "organization-acme" } }),
      authz: createDashboardTestAuthz({ permissions: EDITOR }),
    },
  });
  const trpc = TrpcRootDefinition.forContext<TestContext>().create();
  const runtime = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<TestContext>({ permits: (permission) => EDITOR.includes(permission) }),
  }).mount(boardTrpcTransport, () => app);
  return runtime.createCaller({ actor: { id: AUTHOR } });
}

const refusedOf = (answer: Promise<unknown>) =>
  answer.then(
    () => "<answered>",
    () => "refused",
  );

describe("a board's icon", () => {
  describe("given a member who may create and edit in Shop", () => {
    /** @scenario "A board's icon is created, updated, reset and read through the API" */
    it("creates with an icon, changes it, resets it and lists each", async () => {
      const author = world();

      const made = await author.create({ projectId: SHOP, name: "Trends", icon: "chart-line" });
      const ref = { projectId: SHOP, dashboardId: made.id };
      const changed = await author.update({ ...ref, icon: "rocket" });
      const listed = await author.getAll({ projectId: SHOP });
      const reset = await author.update({ ...ref, icon: null });

      expect([made.icon, changed.icon, listed.map(({ icon }) => icon), reset.icon]).toEqual([
        "chart-line",
        "rocket",
        ["rocket"],
        null,
      ]);
    });

    /** @scenario "A server refuses an icon off the allow-list" */
    it("refuses an icon off the allow-list on create, createAtScope and update", async () => {
      const author = world();
      const made = await author.create({ projectId: SHOP, name: "Trends", icon: "chart-line" });
      const off = "not-an-icon" as never;

      const refused = await Promise.all([
        refusedOf(author.create({ projectId: SHOP, name: "Other", icon: off })),
        refusedOf(
          author.createAtScope({ projectId: SHOP, name: "Other", scope: "PRIVATE", icon: off }),
        ),
        refusedOf(author.update({ projectId: SHOP, dashboardId: made.id, icon: off })),
      ]);
      const boards = await author.getAll({ projectId: SHOP });

      expect(refused).toEqual(["refused", "refused", "refused"]);
      expect(boards.map(({ name, icon }) => [name, icon])).toEqual([["Trends", "chart-line"]]);
    });
  });
});
