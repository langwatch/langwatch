import { afterAll, describe, expect, it } from "vitest";

import { noReduxRule } from "../../src/rules/no-redux.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { browser: {}, process: {} } } },
});

afterAll(() => workspace.cleanup());

function report(filename, code) {
  return runRule(noReduxRule, { code, cwd: workspace.cwd, filename }).map(
    ({ data, messageId }) => ({ messageId, specifier: data.specifier }),
  );
}

describe("given browser code", () => {
  describe("when it imports Redux in any spelling", () => {
    /** @scenario "A Redux import in browser code is reported" */
    it("reports reduxImported naming the specifier", () => {
      const code = [
        'import { configureStore } from "@reduxjs/toolkit";',
        'import { Provider } from "react-redux";',
        'import { createStore } from "redux";',
        'export { thunk } from "redux-thunk";',
        'const lazy = import("react-redux/lib/x");',
      ].join("\n");

      expect(report("modules/agent/browser/src/behavior/s.ts", code)).toEqual([
        { messageId: "reduxImported", specifier: "@reduxjs/toolkit" },
        { messageId: "reduxImported", specifier: "react-redux" },
        { messageId: "reduxImported", specifier: "redux" },
        { messageId: "reduxImported", specifier: "redux-thunk" },
        { messageId: "reduxImported", specifier: "react-redux/lib/x" },
      ]);
    });

    it("also governs the UI app", () => {
      expect(report("apps/ui/src/shell/x.ts", 'import "redux";')).toHaveLength(1);
    });
  });

  describe("when the import is something else or the file is not browser code", () => {
    it("is left alone", () => {
      expect(
        report("modules/agent/browser/src/behavior/s.ts", 'import { x } from "reduxish";'),
      ).toEqual([]);
      expect(report("modules/agent/process/src/services/s.ts", 'import "redux";')).toEqual([]);
      expect(
        report("modules/agent/browser/src/__tests__/s.unit.test.ts", 'import "redux";'),
      ).toEqual([]);
    });
  });
});
