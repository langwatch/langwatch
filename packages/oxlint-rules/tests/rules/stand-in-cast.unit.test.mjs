import { afterAll, describe, expect, it } from "vitest";

import { standInCastRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
});

afterAll(() => workspace.cleanup());

const SOURCE = "modules/agent/process/src/services/agent.service.ts";

function report(code, filename = SOURCE) {
  return runRule(standInCastRule, { code, cwd: workspace.cwd, filename });
}

describe("given a governed source file", () => {
  describe("when a value is cast through unknown", () => {
    /** @scenario "A cast through unknown is a stand-in for the type" */
    it("reports doubleCast", () => {
      const found = report("const client = raw as unknown as PrismaClient;");

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("doubleCast");
      expect(found[0].data.through).toBe("unknown");
      expect(found[0].data.target).toBe("PrismaClient");
    });
  });

  describe("when a value is cast through any", () => {
    /** @scenario "A cast through any is reported once, as one hole" */
    it("reports doubleCast alone", () => {
      const found = report("const client = raw as any as PrismaClient;");

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("doubleCast");
      expect(found[0].data.through).toBe("any");
    });
  });

  describe("when a value is cast to any once", () => {
    /** @scenario "A lone cast to any is left to no-explicit-any" */
    it("reports nothing in either spelling", () => {
      expect(report("const loose = value as any;\nconst other = <any>value;")).toEqual([]);
    });
  });

  describe("when a frozen literal is then cast to a wider type", () => {
    /** @scenario "A cast over as const is a single cast" */
    it("reports nothing for the const, and still reports a real double cast on its line", () => {
      const found = report(
        "const roles = ['admin'] as const as readonly string[];\nconst client = raw as unknown as PrismaClient;",
      );

      expect(found.map((entry) => [entry.messageId, entry.line])).toEqual([["doubleCast", 2]]);
    });
  });

  describe("when a literal is frozen with as const", () => {
    /** @scenario "An as const assertion is allowed" */
    it("reports nothing", () => {
      expect(report("const roles = ['admin', 'member'] as const;")).toEqual([]);
    });
  });

  describe("when a value is cast once to a named type", () => {
    /** @scenario "A single cast to a named type is allowed" */
    it("reports nothing", () => {
      expect(report("const agent = row as Agent;")).toEqual([]);
    });
  });

  describe("when a value is checked with satisfies", () => {
    /** @scenario "A satisfies check is allowed" */
    it("reports nothing", () => {
      expect(report("const agent = { id: 'a' } satisfies Agent;")).toEqual([]);
    });
  });
});

describe("given a test file", () => {
  const TEST_SOURCE = "modules/agent/process/src/services/__tests__/agent.service.unit.test.ts";

  describe("when it casts through unknown to build a double", () => {
    /** @scenario "A double cast inside a test reports the test message" */
    it("reports doubleCastInTest", () => {
      const found = report("const client = {} as unknown as PrismaClient;", TEST_SOURCE);

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("doubleCastInTest");
      expect(found[0].data.through).toBe("unknown");
      expect(found[0].data.target).toBe("PrismaClient");
    });
  });

  describe("when a literal is frozen with as const", () => {
    /** @scenario "A const assertion in a test is left alone" */
    it("reports nothing", () => {
      expect(report("const roles = ['admin', 'member'] as const;", TEST_SOURCE)).toEqual([]);
    });
  });
});

describe("given a file outside the governed roots", () => {
  describe("when it casts through unknown", () => {
    /** @scenario "A stand-in cast outside the governed roots is not reported" */
    it("reports nothing", () => {
      expect(
        report("const client = raw as unknown as PrismaClient;", "tools/shapemod/src/x.ts"),
      ).toEqual([]);
    });
  });
});
