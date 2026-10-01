import { afterAll, describe, expect, it } from "vitest";

import { idGenerationOriginRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {}, contract: {} } } },
});

afterAll(() => workspace.cleanup());

const SERVICE = "modules/agent/process/src/services/agent.service.ts";
const APPLICATION = "apps/api/src/features/agent/agent.composition.ts";
const TEST = "modules/agent/process/src/services/__tests__/agent.unit.test.ts";

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
          ' Import `generate` from `@langwatch/ksuid` and mint it with its kind: `generate("agent").toString()`.',
      );
    });

    /** @scenario "An import of nanoid or uuid is reported with the house import" */
    it("reports the same in a process composition, naming that process's own kind", () => {
      const found = report('import { v4 } from "uuid";\n', APPLICATION);

      expect(found.map((entry) => entry.messageId)).toEqual(["foreignIdModule"]);
      expect(found[0].message).toContain('`generate("agent").toString()`');
    });

    /** @scenario "An import of nanoid or uuid is reported with the house import" */
    it("falls back to a literal kind placeholder when none can be read from the path", () => {
      const found = report('import { v4 } from "uuid";\n', "apps/api/src/some-other-area/thing.ts");

      expect(found[0].message).toContain('`generate("<kind>").toString()`');
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
        'import { generate } from "@langwatch/ksuid";\nexport const id = generate("agent").toString();\n',
      );

      expect(found).toEqual([]);
    });
  });

  describe("when the randomUUID mints an idempotency key", () => {
    /** @scenario "An idempotency key is left to its own rule" */
    it("reports nothing for the property, the variable or the caller's fallback", () => {
      const found = report(
        "export function run(app, input) {\n" +
          "  const idempotencyKey = crypto.randomUUID();\n" +
          "  app.run({ idempotencyKey: input.idempotencyKey ?? `api-${randomUUID()}` });\n" +
          "  return idempotencyKey;\n" +
          "}\n",
      );

      expect(found).toEqual([]);
    });

    /** @scenario "An idempotency key is left to its own rule" */
    it("reports nothing for the key a form binds once through useState", () => {
      const found = report(
        "export function Form() {\n" +
          "  const [idempotencyKey] = useState(() => crypto.randomUUID());\n" +
          "  return idempotencyKey;\n" +
          "}\n",
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
