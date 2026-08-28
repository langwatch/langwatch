/**
 * The reconcile choke point and the folder validity guard, against a fake
 * transaction client.
 *
 * @see specs/suites/folder-membership-invariant.feature
 * @see specs/suites/suite-folders.feature
 */
import { describe, expect, it, vi } from "vitest";
import {
  assertAssignableFolder,
  type FolderMembershipClient,
  reconcileFolderMembership,
} from "../folder-membership";

function makeTx(overrides?: {
  scenarios?: { id: string }[];
  folder?: { id: string } | null;
}): FolderMembershipClient & {
  scenarioFindMany: ReturnType<typeof vi.fn>;
  suiteUpdate: ReturnType<typeof vi.fn>;
  suiteFindFirst: ReturnType<typeof vi.fn>;
  executeRaw: ReturnType<typeof vi.fn>;
} {
  const scenarioFindMany = vi
    .fn()
    .mockResolvedValue(overrides?.scenarios ?? []);
  const suiteUpdate = vi.fn().mockResolvedValue({});
  const suiteFindFirst = vi.fn().mockResolvedValue(overrides?.folder ?? null);
  const executeRaw = vi.fn().mockResolvedValue(0);
  return {
    scenario: { findMany: scenarioFindMany } as never,
    simulationSuite: {
      update: suiteUpdate,
      findFirst: suiteFindFirst,
    } as never,
    $executeRaw: executeRaw as never,
    scenarioFindMany,
    suiteUpdate,
    suiteFindFirst,
    executeRaw,
  };
}

describe("reconcileFolderMembership", () => {
  describe("when the folder holds archived and active cases", () => {
    /** @scenario "Recomputing membership counts only active cases" */
    it("recomputes the member list from active cases only", async () => {
      const tx = makeTx({ scenarios: [{ id: "scen_1" }, { id: "scen_2" }] });

      await reconcileFolderMembership({
        projectId: "proj_1",
        folderId: "folder_1",
        tx,
      });

      // The lock comes before the read that decides what to write, or a
      // second writer reads the list as it was and overwrites this one.
      expect(tx.executeRaw).toHaveBeenCalled();
      expect(tx.executeRaw.mock.invocationCallOrder[0]!).toBeLessThan(
        tx.scenarioFindMany.mock.invocationCallOrder[0]!,
      );
      expect(tx.scenarioFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            projectId: "proj_1",
            folderId: "folder_1",
            archivedAt: null,
          },
        }),
      );
      expect(tx.suiteUpdate).toHaveBeenCalledWith({
        where: { id: "folder_1", projectId: "proj_1" },
        data: { scenarioIds: ["scen_1", "scen_2"] },
      });
    });

    /** @scenario "A scenario belongs to at most one folder" */
    it("derives membership from the case's single folderId, so a case is in one folder only", async () => {
      // The member query filters on folderId equality: a case naming folder A
      // can never be counted into folder B's recompute.
      const tx = makeTx({ scenarios: [] });

      await reconcileFolderMembership({
        projectId: "proj_1",
        folderId: "folder_b",
        tx,
      });

      const where = tx.scenarioFindMany.mock.calls[0]?.[0]?.where;
      expect(where.folderId).toBe("folder_b");
      expect(tx.suiteUpdate).toHaveBeenCalledWith({
        where: { id: "folder_b", projectId: "proj_1" },
        data: { scenarioIds: [] },
      });
    });
  });
});

describe("assertAssignableFolder", () => {
  describe("when the id names an active folder of the project", () => {
    it("passes", async () => {
      const tx = makeTx({ folder: { id: "folder_1" } });

      await expect(
        assertAssignableFolder({
          projectId: "proj_1",
          folderId: "folder_1",
          tx,
        }),
      ).resolves.toBeUndefined();

      expect(tx.suiteFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: "folder_1",
            projectId: "proj_1",
            kind: "folder",
            archivedAt: null,
          },
        }),
      );
    });
  });

  describe("when the id names anything else", () => {
    it("refuses with scenario_folder_not_found", async () => {
      const tx = makeTx({ folder: null });

      await expect(
        assertAssignableFolder({
          projectId: "proj_1",
          folderId: "suite_custom",
          tx,
        }),
      ).rejects.toMatchObject({ code: "scenario_folder_not_found" });
    });
  });
});
