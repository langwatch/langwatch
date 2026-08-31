/**
 * A project's saved views, and who may touch them.
 *
 * Two rules carry weight here. A personal view belongs to one person, and
 * reaching for someone else's is refused as NOT FOUND rather than forbidden —
 * the same answer as an id that does not exist, so a caller cannot use the
 * refusal to learn that somebody else's view is there.
 *
 * The other is the seeding. First access to a project seeds the default views,
 * and a project that already has them gets any new ones backfilled. Both are
 * for the legacy tab strip only: the traces-v2 lens UI seeds its own defaults
 * from code, so seeding server-side on its behalf would double-populate what
 * the customer sees.
 */

import { describe, expect, it } from "vitest";
import { SavedViewNotFoundError, SavedViewReorderError } from "@langwatch/dashboard-contract";
import { SavedViewService } from "../saved-view.service";

type Call = { method: string } & Record<string, unknown>;

function serviceWith(
  options: {
    existing?: Array<{ id: string; name: string; order: number; userId?: string | null }>;
    count?: number;
    byId?: { id: string; userId: string | null } | null;
  } = {},
) {
  const calls: Call[] = [];
  const rows = options.existing ?? [];
  const repository = {
    count: async (input: Record<string, unknown>) => {
      calls.push({ method: "count", ...input });
      return options.count ?? rows.length;
    },
    findAll: async (input: Record<string, unknown>) => {
      calls.push({ method: "findAll", ...input });
      return rows;
    },
    createMany: async (input: Record<string, unknown>) => {
      calls.push({ method: "createMany", ...input });
    },
    tryFindById: async (input: Record<string, unknown>) => {
      calls.push({ method: "tryFindById", ...input });
      return options.byId === undefined ? { id: "view-1", userId: null } : options.byId;
    },
    delete: async (input: Record<string, unknown>) => {
      calls.push({ method: "delete", ...input });
      return { id: "view-1" };
    },
    update: async (input: Record<string, unknown>) => {
      calls.push({ method: "update", ...input });
      return { id: "view-1" };
    },
    findByIds: async (input: Record<string, unknown>) => {
      calls.push({ method: "findByIds", ...input });
      return rows;
    },
    updateOrder: async (input: Record<string, unknown>) => {
      calls.push({ method: "updateOrder", ...input });
    },
  };

  return { calls, service: new SavedViewService(repository as never) };
}

const seeded = (names: string[]) =>
  names.map((name, index) => ({ id: `view-${index}`, name, order: index }));

describe("SavedViewService.getAll", () => {
  describe("given a project nobody has opened yet", () => {
    /** @scenario A project nobody has opened yet is given the default views */
    it("seeds it with the default views", async () => {
      const { service, calls } = serviceWith({ count: 0, existing: [] });

      await service.getAll({ projectId: "project-1" });

      expect(calls.some((call) => call.method === "createMany")).toBe(true);
    });
  });

  describe("given a project that already has views", () => {
    /** @scenario A project that already has views gains only the defaults it lacks */
    it("adds only the defaults it is missing, keeping what is there", async () => {
      // Matched by name, so a renamed view is not re-created and the
      // customer's own edits survive.
      const { service, calls } = serviceWith({ existing: seeded(["All"]) });

      await service.getAll({ projectId: "project-1" });

      const created = calls.find((call) => call.method === "createMany");
      const names = (created?.views as Array<{ name: string }> | undefined)?.map((v) => v.name);
      expect(names).not.toContain("All");
      expect(names?.length ?? 0).toBeGreaterThan(0);
    });

    /** @scenario A renamed default is not created again */
    it("writes nothing when it already has every default", async () => {
      const first = serviceWith({ count: 0, existing: [] });
      await first.service.getAll({ projectId: "project-1" });
      const allSeeds = (
        first.calls.find((call) => call.method === "createMany")?.views as Array<{ name: string }>
      ).map((view) => view.name);

      const { service, calls } = serviceWith({ existing: seeded(allSeeds) });
      await service.getAll({ projectId: "project-1" });

      expect(calls.some((call) => call.method === "createMany")).toBe(false);
    });
  });

  describe("given the traces-v2 lens kind", () => {
    /** @scenario The traces-v2 lens strip is left alone */
    it("seeds nothing, because that UI brings its own defaults", async () => {
      // Seeding here would double-populate the customer's tab strip.
      const { service, calls } = serviceWith({ count: 0, existing: [] });

      await service.getAll({ projectId: "project-1", kind: "v2-traces-lens" });

      expect(calls.some((call) => call.method === "createMany")).toBe(false);
    });

    it("still reads that kind's own views", async () => {
      const { service, calls } = serviceWith({ existing: [] });

      await service.getAll({ projectId: "project-1", kind: "v2-traces-lens" });

      expect(calls.find((call) => call.method === "findAll")?.kind).toBe("v2-traces-lens");
    });
  });

  describe("given no kind at all", () => {
    it("treats it as the legacy one and seeds", async () => {
      const { service, calls } = serviceWith({ count: 0, existing: [] });

      await service.getAll({ projectId: "project-1" });

      expect(calls.some((call) => call.method === "createMany")).toBe(true);
    });
  });
});

describe.each([
  [
    "delete",
    (service: SavedViewService, userId: string) =>
      service.delete({ projectId: "project-1", viewId: "view-1", userId }),
  ],
  [
    "rename",
    (service: SavedViewService, userId: string) =>
      service.rename({ projectId: "project-1", viewId: "view-1", name: "New", userId }),
  ],
])("SavedViewService.%s", (_name, act) => {
  describe("given a view the whole project shares", () => {
    /** @scenario A view the project shares can be changed by any member */
    it("lets any member act on it", async () => {
      const { service } = serviceWith({ byId: { id: "view-1", userId: null } });

      await expect(act(service, "user-1")).resolves.toBeDefined();
    });
  });

  describe("given somebody's personal view", () => {
    /** @scenario A personal view can be changed by its owner */
    it("lets its owner act on it", async () => {
      const { service } = serviceWith({ byId: { id: "view-1", userId: "user-1" } });

      await expect(act(service, "user-1")).resolves.toBeDefined();
    });

    /** @scenario A personal view is refused to everybody else */
    it("refuses anyone else", async () => {
      const { service } = serviceWith({ byId: { id: "view-1", userId: "user-2" } });

      await expect(act(service, "user-1")).rejects.toBeInstanceOf(SavedViewNotFoundError);
    });

    it("refuses without touching the view", async () => {
      const { service, calls } = serviceWith({ byId: { id: "view-1", userId: "user-2" } });

      await act(service, "user-1").catch(() => undefined);

      expect(calls.some((call) => call.method === "delete" || call.method === "update")).toBe(
        false,
      );
    });
  });

  describe("given an id that does not exist", () => {
    /** @scenario The refusal does not reveal that the view exists */
    it("answers exactly as it does for somebody else's view", async () => {
      // Deliberately indistinguishable: a different error here would confirm
      // that the id names a real view belonging to someone else.
      const missing = serviceWith({ byId: null });
      const notMine = serviceWith({ byId: { id: "view-1", userId: "user-2" } });

      const first = await act(missing.service, "user-1").catch((error: Error) => error);
      const second = await act(notMine.service, "user-1").catch((error: Error) => error);

      expect((first as Error).constructor).toBe((second as Error).constructor);
      expect((first as Error).message).toBe((second as Error).message);
    });
  });

  describe("given the view is looked up", () => {
    it("scopes the lookup to the project", async () => {
      const { service, calls } = serviceWith({ byId: { id: "view-1", userId: null } });

      await act(service, "user-1");

      expect(calls.find((call) => call.method === "tryFindById")).toMatchObject({
        id: "view-1",
        projectId: "project-1",
      });
    });
  });
});

describe("SavedViewService.reorder", () => {
  describe("given every id belongs to the project", () => {
    it("writes the new order", async () => {
      const { service, calls } = serviceWith({ existing: seeded(["A", "B"]) });

      await expect(
        service.reorder({ projectId: "project-1", viewIds: ["view-0", "view-1"] }),
      ).resolves.toEqual({ success: true });
      expect(calls.some((call) => call.method === "updateOrder")).toBe(true);
    });
  });

  describe("given an id the project does not have", () => {
    it("refuses and names the ones it could not find", async () => {
      const { service } = serviceWith({ existing: seeded(["A"]) });

      const error = await service
        .reorder({ projectId: "project-1", viewIds: ["view-0", "view-elsewhere"] })
        .catch((caught: SavedViewReorderError) => caught);

      expect(error).toBeInstanceOf(SavedViewReorderError);
      expect((error as SavedViewReorderError).missingIds).toEqual(["view-elsewhere"]);
    });

    /** @scenario Reordering with an id the project does not have changes nothing */
    it("writes no order at all, rather than a partial one", async () => {
      const { service, calls } = serviceWith({ existing: seeded(["A"]) });

      await service
        .reorder({ projectId: "project-1", viewIds: ["view-0", "view-elsewhere"] })
        .catch(() => undefined);

      expect(calls.some((call) => call.method === "updateOrder")).toBe(false);
    });
  });
});
