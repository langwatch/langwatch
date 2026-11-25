import { afterAll, describe, expect, it } from "vitest";

import { sliceReaderIsAHookRule } from "../../src/rules/slice-reader-is-a-hook.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { trace: { layoutVersion: 0, roles: { browser: {} } } },
});

afterAll(() => workspace.cleanup());

const STORE = "modules/trace/browser/src/behavior/drawer-chrome.store.ts";

function messageIds(code) {
  return runRule(sliceReaderIsAHookRule, { code, cwd: workspace.cwd, filename: STORE }).map(
    (finding) => finding.messageId,
  );
}

describe("given a browser file", () => {
  describe("when it binds defineSlice to a name without use", () => {
    /** @scenario "A slice reader under a plain name is reported" */
    it("reports sliceReaderName", () => {
      expect(
        messageIds(
          'export const drawerChrome = defineSlice({ name: "trace:x", create: () => ({}) });',
        ),
      ).toEqual(["sliceReaderName"]);
    });
  });

  describe("when it binds readSlice to a use-prefixed name", () => {
    /** @scenario "A slice reader under a use name is accepted" */
    it("reports nothing", () => {
      expect(
        messageIds('const useWorkflowHostReader = readSlice({ name: "workflow:host" });'),
      ).toEqual([]);
    });
  });

  describe("when it binds another factory to a plain name", () => {
    /** @scenario "Other calls under plain names are not this rule's business" */
    it("reports nothing", () => {
      expect(messageIds('const chrome = createChrome({ name: "trace:x" });')).toEqual([]);
    });
  });
});
