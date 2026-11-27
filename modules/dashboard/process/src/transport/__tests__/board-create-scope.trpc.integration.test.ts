/**
 * @vitest-environment node
 * `boards.createAtScope` on the real tRPC runtime and memory repositories: one write, asking
 * `create` and `setScope`'s grants at the door, so a refused scope leaves no board behind.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */
import { createTrpcRuntime, TrpcRootDefinition } from "@langwatch/api/trpc";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";

import {
  createDashboardTestApp,
  createDashboardTestAuthz,
  TEST_ORGANIZATION_ID,
} from "../../app/__tests__/dashboard.fixture.ts";
import { MemoryDashboardRepositories } from "../../repositories/memory/memory.dashboard.repositories.ts";
import { boardTrpcTransport } from "../board.trpc.ts";

type TestContext = { actor: { id: string } };

const SHOP = "project-shop";
const ME = "member-me";
const CREATE_AND_UPDATE = ["analytics:view", "analytics:create", "analytics:update"];

/** A member whose grants in Shop are `permissions`, at the door and in the services alike. */
function seat({ permissions }: { permissions: readonly string[] }) {
  const repositories = MemoryDashboardRepositories.create();
  const app = createDashboardTestApp({
    repositories,
    dependencies: { authz: createDashboardTestAuthz({ permissions }) },
  });
  const trpc = TrpcRootDefinition.forContext<TestContext>().create();
  const caller = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<TestContext>({
      permits: (permission) => permissions.includes(permission),
    }),
  })
    .mount(boardTrpcTransport, () => app)
    .createCaller({ actor: { id: ME } });
  const stored = () => repositories.boards.findBoardsInProjects({ projectIds: [SHOP] });
  return { caller, stored };
}

describe("boards.createAtScope", () => {
  describe("given a member who may create and update dashboards in Shop", () => {
    /** @scenario "A board made in the library is made at its scope in one write" */
    it("makes an Only me board in one call, with no setScope after it", async () => {
      const { caller, stored } = seat({ permissions: CREATE_AND_UPDATE });

      const made = await caller.createAtScope({ projectId: SHOP, name: "Mine", scope: "PRIVATE" });

      expect(made.scope).toBe("PRIVATE");
      expect((await stored()).map(({ name, scope }) => [name, scope])).toEqual([
        ["Mine", "PRIVATE"],
      ]);
    });

    /** @scenario "A board made in the library is made at its scope in one write" */
    it("stamps an Organization board with its organization, as setScope does", async () => {
      const { caller, stored } = seat({ permissions: CREATE_AND_UPDATE });

      await caller.createAtScope({ projectId: SHOP, name: "Shared", scope: "ORGANIZATION" });

      expect((await stored()).map(({ scope, organizationId }) => [scope, organizationId])).toEqual([
        ["ORGANIZATION", TEST_ORGANIZATION_ID],
      ]);
    });
  });

  describe("given a member who may create but not update dashboards in Shop", () => {
    /** @scenario "A board made in the library is made at its scope in one write" */
    it("refuses an Organization board at the door, and writes nothing", async () => {
      const { caller, stored } = seat({ permissions: ["analytics:view", "analytics:create"] });

      await expect(
        caller.createAtScope({ projectId: SHOP, name: "Shared", scope: "ORGANIZATION" }),
      ).rejects.toMatchObject({ cause: { code: "permission_denied" } });
      expect(await stored()).toEqual([]);
    });

    /** @scenario "A board made in the library is made at its scope in one write" */
    it("still makes a Project board through boards.create", async () => {
      const { caller, stored } = seat({ permissions: ["analytics:view", "analytics:create"] });

      await caller.create({ projectId: SHOP, name: "Ours" });

      expect((await stored()).map(({ scope }) => scope)).toEqual(["PROJECT"]);
    });
  });
});
