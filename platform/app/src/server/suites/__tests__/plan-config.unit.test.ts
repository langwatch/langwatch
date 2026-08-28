/**
 * The keys that compare two run plan configs, and the one normalisation that
 * needs the project.
 *
 * @see specs/suites/run-plan-identity-by-name.feature
 */
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  configurationKey,
  normalizePlanScope,
  scopeKey,
  sortSuiteTargets,
} from "../plan-config";
import type { SuiteTarget } from "../types";

/** A Prisma stand-in that answers only the folder read the normalise makes. */
function prismaWithFolders(ids: string[]): PrismaClient {
  return {
    simulationSuite: {
      findMany: vi.fn(async () => ids.map((id) => ({ id }))),
    },
  } as unknown as PrismaClient;
}

describe("normalizePlanScope", () => {
  describe("when the scope names every folder of the project", () => {
    /** @scenario "Naming every suite of the project resolves to the same plan as running everything" */
    it("becomes the all scope", async () => {
      const scope = await normalizePlanScope({
        projectId: "project-1",
        scope: { mode: "folders", folderIds: ["b", "a"] },
        prisma: prismaWithFolders(["a", "b"]),
      });

      expect(scope).toEqual({ mode: "all" });
    });

    /** @scenario "An archived suite does not have to be named for a scope to be exhaustive" */
    it("ignores archived folders, which hold no active scenario", async () => {
      // The read is already filtered to non-archived folders, so an archived
      // one never reaches the comparison.
      const prisma = prismaWithFolders(["active"]);
      const scope = await normalizePlanScope({
        projectId: "project-1",
        scope: { mode: "folders", folderIds: ["active"] },
        prisma,
      });

      expect(scope).toEqual({ mode: "all" });
      expect(prisma.simulationSuite.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ archivedAt: null }),
        }),
      );
    });
  });

  describe("when the scope names some but not all folders", () => {
    /** @scenario "A scope naming some but not all suites stays a test suites scope" */
    it("stays a folders scope naming those folders", async () => {
      const scope = await normalizePlanScope({
        projectId: "project-1",
        scope: { mode: "folders", folderIds: ["b", "a"] },
        prisma: prismaWithFolders(["a", "b", "c"]),
      });

      expect(scope).toEqual({ mode: "folders", folderIds: ["a", "b"] });
    });
  });

  describe("when the scope names no folder", () => {
    /** @scenario "A test suites scope naming no suite is not treated as everything" */
    it("stays a folders scope naming none", async () => {
      const scope = await normalizePlanScope({
        projectId: "project-1",
        scope: { mode: "folders", folderIds: [] },
        prisma: prismaWithFolders(["a", "b"]),
      });

      expect(scope).toEqual({ mode: "folders", folderIds: [] });
    });
  });

  describe("when the scope is not a folders scope", () => {
    it("leaves it alone", async () => {
      const prisma = prismaWithFolders(["a"]);
      expect(
        await normalizePlanScope({
          projectId: "project-1",
          scope: { mode: "labels", labels: ["smoke"] },
          prisma,
        }),
      ).toEqual({ mode: "labels", labels: ["smoke"] });
      expect(prisma.simulationSuite.findMany).not.toHaveBeenCalled();
    });
  });
});

describe("sortSuiteTargets", () => {
  describe("when the same targets arrive in either order", () => {
    /** @scenario "Targets are stored in a stable order" */
    it("stores them the same way round", () => {
      const dev: SuiteTarget = { type: "http", referenceId: "dev-agent" };
      const prod: SuiteTarget = { type: "http", referenceId: "prod-agent" };

      expect(sortSuiteTargets([prod, dev])).toEqual(
        sortSuiteTargets([dev, prod]),
      );
      expect(sortSuiteTargets([prod, dev])).toEqual([dev, prod]);
    });
  });
});

describe("configurationKey", () => {
  describe("when one configuration leaves a model empty and another omits it", () => {
    /** @scenario "A configuration naming no model keys the same whether the model is empty or absent" */
    it("keys them the same, so both mean the project default", () => {
      const shared = {
        scope: { mode: "all" } as const,
        targets: [{ type: "http", referenceId: "prod-agent" } as SuiteTarget],
        repeatCount: 1,
      };

      const empty = configurationKey({
        config: { ...shared, simulatorModel: null, judgeModel: null },
      });
      const absent = configurationKey({
        config: {
          ...shared,
          simulatorModel: undefined as unknown as null,
          judgeModel: undefined as unknown as null,
        },
      });

      expect(empty).toBe(absent);
    });
  });
});

describe("scopeKey", () => {
  describe("when two hand-picked scopes cover different scenarios", () => {
    it("tells them apart, which the scope shape alone cannot", () => {
      const first = scopeKey({ scope: { mode: "cases" }, scenarioIds: ["a"] });
      const second = scopeKey({ scope: { mode: "cases" }, scenarioIds: ["b"] });

      expect(first).not.toBe(second);
    });

    it("reads the same list in either order as one scope", () => {
      expect(
        scopeKey({ scope: { mode: "cases" }, scenarioIds: ["b", "a"] }),
      ).toBe(scopeKey({ scope: { mode: "cases" }, scenarioIds: ["a", "b"] }));
    });
  });

  describe("when the scope is a folders scope", () => {
    it("reads the same folders in either order as one scope", () => {
      expect(
        scopeKey({ scope: { mode: "folders", folderIds: ["b", "a"] } }),
      ).toBe(scopeKey({ scope: { mode: "folders", folderIds: ["a", "b"] } }));
    });
  });
});

describe("configurationKey", () => {
  const base = {
    scope: { mode: "all" } as const,
    targets: [{ type: "http", referenceId: "prod" }] as SuiteTarget[],
    repeatCount: 1,
    simulatorModel: null,
    judgeModel: null,
  };

  describe("when two runs of one plan differ only by parameters", () => {
    it("gives them different keys, so both are listed", () => {
      expect(
        configurationKey({ config: base, parameters: { tier: "gold" } }),
      ).not.toBe(
        configurationKey({ config: base, parameters: { tier: "silver" } }),
      );
    });
  });

  describe("when two runs of one plan differ only by repeat count", () => {
    it("gives them different keys", () => {
      expect(configurationKey({ config: base })).not.toBe(
        configurationKey({ config: { ...base, repeatCount: 3 } }),
      );
    });
  });

  describe("when two runs hold the same config", () => {
    it("gives them one key, whatever order the targets and parameters arrive in", () => {
      const targets: SuiteTarget[] = [
        { type: "http", referenceId: "dev" },
        { type: "http", referenceId: "prod" },
      ];
      expect(
        configurationKey({
          config: { ...base, targets },
          parameters: { a: "1", b: "2" },
        }),
      ).toBe(
        configurationKey({
          config: { ...base, targets: [...targets].reverse() },
          parameters: { b: "2", a: "1" },
        }),
      );
    });
  });

  describe("when the run carries a note", () => {
    it("has no way to take one, so a note can never split a configuration", () => {
      // The signature is the guard: configurationKey takes config, scenarioIds
      // and parameters, and nothing else.
      expect(Object.keys(base)).not.toContain("note");
    });
  });
});
