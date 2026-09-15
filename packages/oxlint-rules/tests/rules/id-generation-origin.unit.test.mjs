import { afterAll, describe, expect, it } from "vitest";
import { idGenerationOriginRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {}, contract: {} } } },
});

afterAll(() => workspace.cleanup());

const SERVICE = "modules/agent/server/src/services/agent.service.ts";
const APPLICATION = "apps/api/src/features/agent/agent.composition.ts";
const TEST = "modules/agent/server/src/services/__tests__/agent.unit.test.ts";

function report(code, filename = SERVICE) {
  return runRule(idGenerationOriginRule, { code, cwd: workspace.cwd, filename });
}

describe("given a strict feature or process source", () => {
  describe("when a module imports a foreign id generator", () => {
    /** @scenario "An import of nanoid or uuid is reported with the house import" */
    it("reports foreignIdModule naming the module", () => {
      const found = report('import { nanoid } from "nanoid";\nexport const id = nanoid();\n');

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("foreignIdModule");
      expect(found[0].message).toBe(
        "`nanoid` mints ids outside the house scheme." +
          " Import `generate` from `@langwatch/ksuid` and prefix the kind: `agent_${generate()}`.",
      );
    });

    /** @scenario "An import of nanoid or uuid is reported with the house import" */
    it("reports the same in a process composition", () => {
      const found = report('import { v4 } from "uuid";\n', APPLICATION);

      expect(found.map((entry) => entry.messageId)).toEqual(["foreignIdModule"]);
    });
  });

  describe("when a module calls randomUUID", () => {
    /** @scenario "A randomUUID call is reported with the house import" */
    it("reports randomUuid for the bare call and the crypto member call", () => {
      const found = report(
        'import { randomUUID } from "node:crypto";\nexport const a = randomUUID();\nexport const b = crypto.randomUUID();\n',
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["randomUuid", "randomUuid"]);
    });
  });

  describe("when a module mints ids the house way", () => {
    /** @scenario "A ksuid import is left alone" */
    it("reports nothing", () => {
      const found = report(
        'import { generate } from "@langwatch/ksuid";\nexport const id = `agent_${generate()}`;\n',
      );

      expect(found).toEqual([]);
    });
  });

  describe("when the module is a test", () => {
    it("reports nothing", () => {
      const found = report('import { nanoid } from "nanoid";\n', TEST);

      expect(found).toEqual([]);
    });
  });
});
