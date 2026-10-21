import type { DashboardApi } from "@langwatch/dashboard-contract";
import { describe, expect, it } from "vitest";

import { dashboardRest } from "../dashboard.rest.ts";

const deleteMark = () =>
  dashboardRest.router().routes.find((route) => route.method === "delete")?.confirmation;

/** An app whose only read records who it read as. */
function recordingApp() {
  const reads: unknown[] = [];
  const app = {
    getById: async (input: unknown) => {
      reads.push(input);
      return { name: "Board" };
    },
  } as unknown as DashboardApi;
  return { app, reads };
}

describe("given a Reports dashboard delete that asks for confirmation", () => {
  describe("when the card reads the dashboard's name", () => {
    it("reads it as the key's owner", async () => {
      const { app, reads } = recordingApp();

      await deleteMark()?.name({ app, projectId: "project-1", id: "d1", ownerUserId: "user-1" });

      expect(reads).toEqual([
        { projectId: "project-1", dashboardId: "d1", viewer: { userId: "user-1" } },
      ]);
    });

    it("reads with no viewer for a key that names nobody", async () => {
      const { app, reads } = recordingApp();

      await deleteMark()?.name({ app, projectId: "project-1", id: "d1", ownerUserId: null });

      expect(reads).toEqual([{ projectId: "project-1", dashboardId: "d1" }]);
    });
  });
});
