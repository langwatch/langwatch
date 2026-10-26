import { afterAll, describe, expect, it } from "vitest";

import { noPreprocessInEventSchemaRule } from "../../src/rules/no-preprocess-in-event-schema.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { contract: {}, process: {} } } },
});

afterAll(() => workspace.cleanup());

const EVENTS = "modules/agent/contract/src/agent.events.ts";
const OTHER = "modules/agent/contract/src/agent-input.ts";
const IMPORT = 'import { z } from "zod";';

function report(code, filename = EVENTS) {
  return runRule(noPreprocessInEventSchemaRule, { code, cwd: workspace.cwd, filename }).map(
    ({ line, messageId }) => ({ line, messageId }),
  );
}

describe("given a module's contract", () => {
  describe("when an events file reshapes input with z.preprocess", () => {
    /** @scenario "z.preprocess in an events file is reported" */
    it("reports preprocessInEventSchema on the call", () => {
      const code = [
        IMPORT,
        "export const startedSchema = z.preprocess(",
        "  (stored) => stored,",
        "  z.object({ id: z.string() }),",
        ");",
      ].join("\n");

      expect(report(code)).toEqual([{ line: 2, messageId: "preprocessInEventSchema" }]);
    });

    /** @scenario "The report asks for a version and an upcast" */
    it("names the version and the upcast in the fix", () => {
      const [finding] = runRule(noPreprocessInEventSchemaRule, {
        code: `${IMPORT}\nexport const a = z.preprocess((x) => x, z.string());`,
        cwd: workspace.cwd,
        filename: EVENTS,
      });

      expect(finding.message).toContain("Version the event and add an upcast");
    });
  });

  describe("when a payload schema outside an events file reshapes input", () => {
    /** @scenario "A payload schema is recognised by its name" */
    it("reports a const named for a payload or event data schema", () => {
      const code = [
        IMPORT,
        "const registeredPayloadSchemaDefinition = z.preprocess((x) => x, z.object({}));",
        "export const startedEventDataSchema = z.preprocess((x) => x, z.object({}));",
      ].join("\n");

      expect(report(code, OTHER)).toEqual([
        { line: 2, messageId: "preprocessInEventSchema" },
        { line: 3, messageId: "preprocessInEventSchema" },
      ]);
    });
  });

  describe("when preprocess shapes something that is not an event payload", () => {
    /** @scenario "Config and input schemas may preprocess" */
    it("reports nothing", () => {
      const code = [IMPORT, "export const blankIsUnset = z.preprocess((x) => x, z.string());"].join(
        "\n",
      );

      expect(report(code, OTHER)).toEqual([]);
      expect(report(code, "modules/agent/process/src/agent-config.ts")).toEqual([]);
    });
  });

  describe("when a process package's events file reshapes input", () => {
    /** @scenario "An events file in a process package is governed too" */
    it("reports preprocessInEventSchema on the call", () => {
      const code = `${IMPORT}\nexport const a = z.preprocess((x) => x, z.string());`;

      expect(report(code, "modules/agent/process/src/agent.events.ts")).toEqual([
        { line: 2, messageId: "preprocessInEventSchema" },
      ]);
    });
  });

  describe("when zod is imported under another spelling", () => {
    /** @scenario "Preprocess is recognised however zod is imported" */
    it("reports each preprocess call", () => {
      const code = [
        'import { z as zod, preprocess as reshape } from "zod";',
        'import * as v4 from "zod/v4";',
        "export const a = zod.preprocess((x) => x, zod.string());",
        "export const b = reshape((x) => x, zod.string());",
        "export const c = v4.preprocess((x) => x, v4.string());",
      ].join("\n");

      expect(report(code)).toEqual([
        { line: 3, messageId: "preprocessInEventSchema" },
        { line: 4, messageId: "preprocessInEventSchema" },
        { line: 5, messageId: "preprocessInEventSchema" },
      ]);
    });

    it("ignores a preprocess that does not come from zod", () => {
      const code = [
        'import { z } from "zod";',
        'import { preprocess } from "./local";',
        "const other = { preprocess: (x) => x };",
        "export const a = preprocess((x) => x);",
        "export const b = other.preprocess((x) => x);",
      ].join("\n");

      expect(report(code)).toEqual([]);
    });
  });

  describe("when a payload schema's field preprocesses", () => {
    /** @scenario "A preprocess nested in a payload field is reported" */
    it("reports the nested call", () => {
      const code = [
        IMPORT,
        "export const schemas = {",
        "  startedPayloadSchema: z.object({",
        "    at: z.preprocess((x) => x, z.number()),",
        "  }),",
        "};",
        "export const finishedEventDataSchema = z.object({",
        "  outcome: z.object({ code: z.preprocess((x) => x, z.string()) }),",
        "});",
      ].join("\n");

      expect(report(code, OTHER)).toEqual([
        { line: 4, messageId: "preprocessInEventSchema" },
        { line: 8, messageId: "preprocessInEventSchema" },
      ]);
    });
  });
});
