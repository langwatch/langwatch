import { afterAll, describe, expect, it } from "vitest";

import { browserStoreContainmentRule } from "../../src/rules/browser-store-containment.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { browser: {}, "browser-kit": {} } } },
});

afterAll(() => workspace.cleanup());

const BROWSER = "modules/agent/browser/src";
const STORE = 'import { create } from "zustand";\nexport const useAgentStore = create(() => ({}));';

function report(filename, code) {
  return runRule(browserStoreContainmentRule, { code, cwd: workspace.cwd, filename }).map(
    ({ line, messageId }) => ({ line, messageId }),
  );
}

describe("given a zustand store in a browser package", () => {
  describe("when it is created under behavior/", () => {
    it("is allowed, including nested feature folders", () => {
      expect(report(`${BROWSER}/behavior/agent.store.ts`, STORE)).toEqual([]);
      expect(report(`${BROWSER}/features/x/behavior/x.store.ts`, STORE)).toEqual([]);
    });
  });

  describe("when it is created anywhere else", () => {
    it("reports storeOutsideBehavior on the call, for create and createStore", () => {
      expect(report(`${BROWSER}/ui/sections/panel.tsx`, STORE)).toEqual([
        { line: 2, messageId: "storeOutsideBehavior" },
      ]);
      const vanilla = 'import { createStore as make } from "zustand/vanilla";\nmake(() => ({}));';

      expect(report(`${BROWSER}/model/x.ts`, vanilla)).toEqual([
        { line: 2, messageId: "storeOutsideBehavior" },
      ]);
    });
  });

  describe("when the declaration file exports a store", () => {
    it("reports storeExported for re-exports and store-named bindings", () => {
      const code = [
        'export { useAgentStore } from "./behavior/agent.store";',
        'export * from "./behavior/agent-store";',
        'import { useOther } from "./behavior/x";\nexport { useOther as useOtherStore };',
      ].join("\n");

      expect(report(`${BROWSER}/agent.web.ts`, code).map((found) => found.messageId)).toEqual([
        "storeExported",
        "storeExported",
        "storeExported",
      ]);
    });

    it("leaves type re-exports and other exports alone", () => {
      const code =
        'export type { AgentState } from "./behavior/agent.store";\nexport { defineAgent } from "./agent";';

      expect(report(`${BROWSER}/agent.web.ts`, code)).toEqual([]);
    });
  });

  describe("when the file is a kit, a test or uses a non-zustand create", () => {
    it("is not governed or not a store", () => {
      expect(report("modules/agent/browser-kit/src/model/s.ts", STORE)).toEqual([]);
      expect(report(`${BROWSER}/__tests__/s.unit.test.ts`, STORE)).toEqual([]);
      expect(report(`${BROWSER}/ui/x.ts`, 'import { create } from "other";\ncreate();')).toEqual(
        [],
      );
    });
  });
});
