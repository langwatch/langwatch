import { afterAll, describe, expect, it } from "vitest";
import { temporalOnlyRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const BASELINED = "packages/features/agent/server/src/services/legacy.service.ts";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
  files: {
    "packages/architecture-lint/src/oxlint-baseline.json": JSON.stringify({
      version: 0,
      entries: [{ key: `temporal-only|${BASELINED}`, measured: "2026-09-06" }],
    }),
  },
});

afterAll(() => workspace.cleanup());

const SERVICE = "packages/features/agent/server/src/services/agent.service.ts";

function report(code, filename = SERVICE) {
  return runRule(temporalOnlyRule, { code, cwd: workspace.cwd, filename });
}

function ids(code, filename) {
  return report(code, filename).map((entry) => entry.messageId);
}

describe("given production source", () => {
  describe("when it mints the current moment as a Date", () => {
    /** @scenario "Minting the current moment as a Date is reported" */
    it("reports mintNow and names the Temporal replacement", () => {
      const found = report("const started = new Date();");

      expect(found.map((entry) => entry.messageId)).toEqual(["mintNow"]);
      expect(found[0].message).toContain("nowInstant()");
    });
  });

  describe("when it reads the current moment as epoch milliseconds", () => {
    /** @scenario "Reading the clock through Date.now is reported" */
    it("reports mintNowMilliseconds", () => {
      const found = report("const ms = Date.now();");

      expect(found.map((entry) => entry.messageId)).toEqual(["mintNowMilliseconds"]);
      expect(found[0].message).toContain("nowInstant().epochMilliseconds");
    });
  });

  describe("when it builds a Date out of a value", () => {
    /** @scenario "Constructing a Date from a value is reported" */
    it("reports constructInstant", () => {
      expect(ids("const at = new Date(row.createdAt);")).toEqual(["constructInstant"]);
    });
  });

  describe("when it parses a moment through Date.parse", () => {
    /** @scenario "Parsing a moment through Date.parse is reported" */
    it("reports parseInstant", () => {
      expect(ids("const ms = Date.parse(iso);")).toEqual(["parseInstant"]);
    });
  });

  describe("when it builds an epoch count through Date.UTC", () => {
    /** @scenario "Building an epoch count through Date.UTC is reported" */
    it("reports utcInstant", () => {
      expect(ids("const ms = Date.UTC(2026, 5, 15);")).toEqual(["utcInstant"]);
    });
  });

  describe("when a declaration is typed Date", () => {
    /** @scenario "A value typed Date is reported" */
    it("reports dateType and names the declaration", () => {
      const found = report("export function seen(at: Date): void {}");

      expect(found.map((entry) => entry.messageId)).toEqual(["dateType"]);
      expect(found[0].message).toContain("at is typed");
    });
  });

  describe("when a boundary helper owns the conversion", () => {
    /** @scenario "The named boundary helpers keep their Date" */
    it("reports nothing inside fromDate or toDate", () => {
      expect(
        ids(
          "export function toDate(value: Instant): Date { return new Date(value.epochMilliseconds); }\n" +
            "export function fromDate(value: Date) { return Temporal.Instant.fromEpochMilliseconds(value.getTime()); }",
        ),
      ).toEqual([]);
    });
  });

  describe("when a member call only looks like Date.now", () => {
    /** @scenario "A member call on another object is left alone" */
    it("reports nothing", () => {
      expect(ids("const ms = clock.now();")).toEqual([]);
    });
  });
});

describe("given a file outside the governed source", () => {
  describe("when it is the Prisma repository seam", () => {
    /** @scenario "The Prisma seam keeps its Date" */
    it("reports nothing", () => {
      expect(
        ids(
          "const at: Date = new Date();",
          "packages/features/agent/server/src/repositories/prisma/agent.repository.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when it is the Postgres adapter", () => {
    /** @scenario "The Postgres adapter keeps its Date" */
    it("reports nothing", () => {
      expect(
        ids(
          "const at = new Date();",
          "packages/features/agent/server/src/adapters/postgres.agent.adapter.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when it is a test", () => {
    /** @scenario "Test files keep their Date fixtures" */
    it("reports nothing", () => {
      expect(
        ids(
          "const at = new Date('2026-06-15T10:30:00Z');",
          "packages/features/agent/server/src/__tests__/agent.unit.test.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when the file carries a baseline entry", () => {
    /** @scenario "A file on the debt register is left alone" */
    it("reports nothing", () => {
      expect(ids("const at = new Date();", BASELINED)).toEqual([]);
    });
  });

  describe("when it is the time package itself", () => {
    /** @scenario "The time package keeps its Date" */
    it("reports nothing", () => {
      expect(ids("const at = new Date();", "packages/time/src/zoned.ts")).toEqual([]);
    });
  });
});
