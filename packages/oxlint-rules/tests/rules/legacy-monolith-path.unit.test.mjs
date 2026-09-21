import { afterAll, describe, expect, it } from "vitest";
import { legacyMonolithPathRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
});

afterAll(() => workspace.cleanup());

const FILE = "modules/agent/process/src/services/agent.service.ts";

function report(code, filename = FILE) {
  return runRule(legacyMonolithPathRule, { code, cwd: workspace.cwd, filename });
}

describe("given a source file", () => {
  describe("when it imports through the monolith's `~/` alias", () => {
    /** @scenario "An import through the monolith alias is refused" */
    it("reports legacyMonolithPath", () => {
      const found = report('import { api } from "~/utils/api";');

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("legacyMonolithPath");
      expect(found[0].data.name).toBe("~/utils/api");
    });
  });

  describe("when it imports a path that names platform/", () => {
    /** @scenario "An import naming the deleted platform directory is refused" */
    it("reports legacyMonolithPath", () => {
      const found = report('import { x } from "../../platform/app/src/server/x";');

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("legacyMonolithPath");
    });
  });

  describe("when a plain string names a platform/ path", () => {
    /** @scenario "A string naming a platform path is refused" */
    it("reports legacyMonolithPath", () => {
      const found = report('const source = "platform/app/src/server/scenarios/suite-fields.ts";');

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("legacyMonolithPath");
    });
  });

  describe("when it imports from a module package", () => {
    /** @scenario "An import from a module package is allowed" */
    it("reports nothing", () => {
      const found = report('import { api } from "@langwatch/agent-browser/agent-client";');

      expect(found).toHaveLength(0);
    });
  });

  describe("when the path is an application's own platform directory", () => {
    /** @scenario "An application's own platform directory is allowed" */
    it("reports nothing", () => {
      const found = report('import { env } from "apps/api/src/platform/config/env.composition.ts";');

      expect(found).toHaveLength(0);
    });
  });

  describe("when a word merely ends in platform", () => {
    /** @scenario "A path whose segment merely ends in platform is allowed" */
    it("reports nothing", () => {
      const found = report('const doc = "cross-platform/notes.md";');

      expect(found).toHaveLength(0);
    });
  });
});

describe("given the rule tells the reader to re-point a specifier", () => {
  describe("when the string is not a module specifier", () => {
    /** @scenario "A home-directory string is not a monolith path" */
    it("leaves a home-directory path alone but still reports the alias in an import", () => {
      expect(report('const p = "~/.codex/hooks.json";')).toEqual([]);
      expect(report('import { a } from "~/server/db";').map((e) => e.messageId)).toEqual([
        "legacyMonolithPath",
      ]);
    });

    /** @scenario "A test may name a platform path in a plain string" */
    it("leaves a platform path in a test's data alone, and reports it in production", () => {
      const data = 'const wasFiles = ["platform/app/src/server/db.ts"];';

      expect(report(data, "modules/agent/process/src/__tests__/paths.unit.test.ts")).toEqual([]);
      expect(report(data).map((e) => e.messageId)).toEqual(["legacyMonolithPath"]);
    });

    /** @scenario "A test may name a platform path in a plain string" */
    it("still reports an import naming platform/app from inside a test", () => {
      const found = report(
        'import { a } from "../../platform/app/src/db.ts";',
        "modules/agent/process/src/__tests__/paths.unit.test.ts",
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["legacyMonolithPath"]);
    });
  });

  describe("when one import is visited by both the parent and the literal", () => {
    /** @scenario "A stale import is reported once, not twice" */
    it("reports it exactly once", () => {
      expect(report('import { a } from "~/server/db";')).toHaveLength(1);
    });
  });
});
