import { afterAll, describe, expect, it } from "vitest";

import { eventingRolePurityRule } from "../../src/rules/eventing-role-purity.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const EVENTING = "modules/trace/process/src/eventing";
const workspace = createFixtureWorkspace({
  files: {
    [`${EVENTING}/__tests__/proven.subscriber.redelivery.test.ts`]: "export {};\n",
  },
});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(eventingRolePurityRule, { code, cwd: workspace.cwd, filename });
}

const PROJECTION = `${EVENTING}/trace-summary.projection.ts`;
const PROCESS_MANAGER = `${EVENTING}/processes/trace-retention.process.ts`;

describe("given a projection", () => {
  describe("when its fold awaits, declares async work, sets a timer or imports I/O", () => {
    /** @scenario "Eventing roles remain mechanically distinct" */
    it.each([
      [
        'import { readFileSync } from "node:fs";\nexport {};',
        1,
        'imports the I/O module "node:fs"',
      ],
      ["export const fold = async (state) => state;", 1, "declares async work"],
      ["const seed = {};\nexport const state = await seed;", 2, "awaits work"],
      ["export function fold(state) {\n  setTimeout(() => {}, 1);\n}", 2, "calls setTimeout()"],
      [
        'export function fold() {\n  return import("./late");\n}',
        2,
        "imports a module dynamically",
      ],
    ])("reports projectionImpure at the offending line for %s", (code, line, detail) => {
      expect(report(code, PROJECTION)).toEqual([
        expect.objectContaining({ messageId: "projectionImpure", line, data: { detail } }),
      ]);
    });
  });

  describe("when the fold has several impurities", () => {
    /** @scenario "A projection with several impurities is reported once, at the first" */
    it("reports the first one only", () => {
      const code = "export function fold(state) {\n  fetch('x');\n  setTimeout(() => {}, 1);\n}";

      expect(report(code, PROJECTION)).toEqual([
        expect.objectContaining({ line: 2, data: { detail: "calls fetch()" } }),
      ]);
    });
  });

  describe("when the fold is synchronous and pure", () => {
    it("reports nothing", () => {
      expect(
        report("export const fold = (state, event) => ({ ...state, ...event });", PROJECTION),
      ).toEqual([]);
    });
  });
});

describe("given a process manager", () => {
  describe("when a method is declared async", () => {
    /** @scenario "A process manager that declares async work is reported at the method" */
    it("reports processImpure at the method", () => {
      const code = "export class Retention {\n  async decide() {\n    return 1;\n  }\n}";

      expect(report(code, PROCESS_MANAGER)).toEqual([
        expect.objectContaining({ messageId: "processImpure", line: 2 }),
      ]);
    });
  });

  describe("when it appends durable events itself", () => {
    /** @scenario "No eventing role appends durable events directly" */
    it("reports durableEvent naming the call", () => {
      const code = "export function decide(store) {\n  store.appendEvents([]);\n}";

      expect(report(code, PROCESS_MANAGER)).toEqual([
        expect.objectContaining({
          messageId: "durableEvent",
          line: 2,
          data: { name: "appendEvents", role: "Process manager" },
        }),
      ]);
    });
  });
});

describe("given a subscriber", () => {
  describe("when it has no redelivery test beside it", () => {
    /** @scenario "A subscriber without a named redelivery test is reported" */
    it("reports missingRedeliveryTest with the path to add", () => {
      expect(
        report("export async function onEvent() {}", `${EVENTING}/unproven.subscriber.ts`),
      ).toEqual([
        expect.objectContaining({
          messageId: "missingRedeliveryTest",
          line: 1,
          data: {
            expected: "src/eventing/__tests__/unproven.subscriber.redelivery.test.ts",
            name: "unproven.subscriber.ts",
          },
        }),
      ]);
    });
  });

  describe("when its redelivery test exists and it awaits work", () => {
    /** @scenario "A subscriber may await work once its redelivery test exists" */
    it("reports nothing", () => {
      const code = "export async function onEvent(event) {\n  await fetch(event.url);\n}";

      expect(report(code, `${EVENTING}/proven.subscriber.ts`)).toEqual([]);
    });
  });
});

describe("given files outside the eventing roles", () => {
  it.each([
    [`${EVENTING}/__tests__/trace-summary.projection.ts`, "export const f = async () => 1;"],
    ["modules/trace/process/src/services/trace.service.ts", "export const f = async () => 1;"],
    ["apps/api/src/api.process.ts", "export const f = async () => 1;"],
  ])("reports nothing for %s", (filename, code) => {
    expect(report(code, filename)).toEqual([]);
  });

  it("reads projections under the api and worker applications", () => {
    const found = report("export const f = async () => 1;", "apps/worker/src/usage.projection.ts");

    expect(found).toEqual([expect.objectContaining({ messageId: "projectionImpure" })]);
  });
});
