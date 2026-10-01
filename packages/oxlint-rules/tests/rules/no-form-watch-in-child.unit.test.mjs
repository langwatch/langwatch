import { afterAll, describe, expect, it } from "vitest";

import { noFormWatchInChildRule } from "../../src/rules/no-form-watch-in-child.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

const SECTION = "modules/agent/browser/src/ui/sections/agent-settings.tsx";

function report(code, filename = SECTION) {
  return runRule(noFormWatchInChildRule, { code, cwd: workspace.cwd, filename });
}

describe("given a browser package source file", () => {
  describe("when a component calls watch on a form it received as a prop", () => {
    /** @scenario "Watching a form received as a prop is reported" */
    it("reports watchOnReceivedForm on each watch call's line", () => {
      const found = report(
        [
          "export function AgentSettings({ form }) {",
          '  const name = form.watch("name");',
          "  return name;",
          "}",
          "export function Other(form) {",
          "  return form.watch();",
          "}",
        ].join("\n"),
      );

      expect(found.map((finding) => [finding.line, finding.data.form])).toEqual([
        [2, "form"],
        [6, "form"],
      ]);
      expect(found[0].message).toBe(
        "`form.watch()` runs on a form this component received as a prop, so the whole form tree re-renders on every keystroke." +
          " Read the value with `useWatch({ control: form.control, name })` instead.",
      );
    });
  });

  describe("when the component watches the form it owns", () => {
    /** @scenario "Watching the form a component owns is left alone" */
    it("reports nothing", () => {
      const found = report(
        [
          "export function AgentSettings() {",
          "  const form = useForm();",
          '  return form.watch("name");',
          "}",
        ].join("\n"),
      );

      expect(found).toEqual([]);
    });
  });
});

describe("given a file outside a browser package", () => {
  describe("when it watches a received form", () => {
    it("reports nothing", () => {
      const code = "export function f(form) { return form.watch(); }";

      expect(report(code, "modules/agent/process/src/services/agent.service.ts")).toEqual([]);
      expect(
        report(
          code,
          "modules/agent/browser/src/ui/sections/__tests__/agent-settings.unit.test.tsx",
        ),
      ).toEqual([]);
    });
  });
});
