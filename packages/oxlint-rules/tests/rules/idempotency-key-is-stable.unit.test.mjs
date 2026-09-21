import { afterAll, describe, expect, it } from "vitest";
import { idempotencyKeyIsStableRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { browser: {}, process: {} } } },
});

afterAll(() => workspace.cleanup());

const BEHAVIOR = "modules/agent/browser/src/behavior/use-run-agent.ts";
const TEST = "modules/agent/browser/src/behavior/__tests__/use-run-agent.unit.test.ts";

function report(code, filename = BEHAVIOR) {
  return runRule(idempotencyKeyIsStableRule, { code, cwd: workspace.cwd, filename });
}

describe("given a production source", () => {
  describe("when a key is minted inline at the assignment", () => {
    /** @scenario "A key minted at the call site is reported" */
    it("reports mintedAtCallSite naming the property and the mint", () => {
      const found = report(
        "export function run(mutate) {\n" +
          "  mutate({ id: 1, idempotencyKey: crypto.randomUUID() });\n" +
          "}\n",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("mintedAtCallSite");
      expect(found[0].message).toBe(
        "`idempotencyKey` is minted here by `crypto.randomUUID()`, so every retry sends a" +
          " different key and nothing is deduplicated." +
          " Derive it from the request's own content, or bind it once for the operation it" +
          " identifies — `useState(() => crypto.randomUUID())` for a form, a key threaded from" +
          " the caller for a mutation — and pass that binding here.",
      );
    });

    /** @scenario "A key minted at the call site is reported" */
    it("reports the other non-deterministic mints and the templates built from them", () => {
      const found = report(
        "export function run(mutate) {\n" +
          "  mutate({ idempotencyKey: nanoid() });\n" +
          "  mutate({ idempotencyKey: uuidv4() });\n" +
          "  mutate({ idempotencyKey: `run-${Date.now()}` });\n" +
          "  mutate({ idempotencyKey: `cli-${Math.random().toString(36).slice(2)}` });\n" +
          "}\n",
      );

      expect(found.map((entry) => entry.data.source)).toEqual([
        "nanoid()",
        "uuidv4()",
        "Date.now()",
        "Math.random()",
      ]);
    });

    /** @scenario "A key minted at the call site is reported" */
    it("reports a key minted into a variable and into a field of that name", () => {
      const found = report(
        "export function run(request) {\n" +
          "  const idempotencyKey = crypto.randomUUID();\n" +
          "  request.idempotencyKey = crypto.randomUUID();\n" +
          "  return idempotencyKey;\n" +
          "}\n",
      );

      expect(found.map((entry) => entry.messageId)).toEqual([
        "mintedAtCallSite",
        "mintedAtCallSite",
      ]);
    });
  });

  describe("when the key names a value bound elsewhere", () => {
    /** @scenario "A key read from a binding is left alone" */
    it("reports nothing for an identifier or a member expression", () => {
      const found = report(
        "export function run(mutate, key, input) {\n" +
          "  mutate({ idempotencyKey: key });\n" +
          "  mutate({ idempotencyKey: input.idempotencyKey });\n" +
          "}\n",
      );

      expect(found).toEqual([]);
    });
  });

  describe("when the key is bound once for the operation", () => {
    /** @scenario "A key bound once for the operation is left alone" */
    it("reports nothing for a useState, useMemo or useRef binding", () => {
      const found = report(
        "export function useForm(mutate) {\n" +
          "  const [idempotencyKey] = useState(() => crypto.randomUUID());\n" +
          "  const memoised = useMemo(() => ({ idempotencyKey: crypto.randomUUID() }), []);\n" +
          "  mutate({ idempotencyKey });\n" +
          "  return memoised;\n" +
          "}\n",
      );

      expect(found).toEqual([]);
    });

    /** @scenario "A key bound once for the operation is left alone" */
    it("reports nothing for a key written into a ref slot", () => {
      const found = report(
        "export function useAttempt(attemptRef, key) {\n" +
          "  if (attemptRef.current?.key !== key) {\n" +
          "    attemptRef.current = { key, idempotencyKey: crypto.randomUUID() };\n" +
          "  }\n" +
          "  return attemptRef.current;\n" +
          "}\n",
      );

      expect(found).toEqual([]);
    });

    /** @scenario "A key bound once for the operation is left alone" */
    it("reports nothing for a module-level constant", () => {
      const found = report("export const idempotencyKey = crypto.randomUUID();\n");

      expect(found).toEqual([]);
    });
  });

  describe("when the caller may supply the key", () => {
    /** @scenario "A caller-supplied key with a fallback is left alone" */
    it("reports nothing for a fallback behind the caller's own key", () => {
      const found = report(
        "export function run(app, input) {\n" +
          "  return app.run({ idempotencyKey: input.idempotencyKey ?? `api-${randomUUID()}` });\n" +
          "}\n",
      );

      expect(found).toEqual([]);
    });
  });

  describe("when the key is derived from the request's own content", () => {
    /** @scenario "A key derived from the request is left alone" */
    it("reports nothing for a hash of the arguments", () => {
      const found = report(
        "export function run(mutate, input) {\n" +
          "  mutate({ idempotencyKey: `run-${hashOf(input)}` });\n" +
          "}\n",
      );

      expect(found).toEqual([]);
    });
  });

  describe("when the module is a test", () => {
    it("reports nothing", () => {
      const found = report(
        "it('runs', () => run({ idempotencyKey: crypto.randomUUID() }));\n",
        TEST,
      );

      expect(found).toEqual([]);
    });
  });
});
