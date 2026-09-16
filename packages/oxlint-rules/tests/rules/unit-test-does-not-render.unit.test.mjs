import { afterAll, describe, expect, it } from "vitest";
import { unitTestDoesNotRenderRule } from "../../src/rules/unit-test-does-not-render.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(unitTestDoesNotRenderRule, { code, cwd: workspace.cwd, filename });
}

describe("given a .unit.test.tsx file", () => {
  const filename = "modules/agent/web/src/ui/blocks/__tests__/agent-card.unit.test.tsx";

  describe("when it imports from @testing-library/react", () => {
    /** @scenario "A unit test importing testing-library is reported once" */
    it("reports unitTestImportsRenderer once, naming the integration-test target", () => {
      const found = report(
        'import { render } from "@testing-library/react";\n' +
          'import { screen } from "@testing-library/dom";\n' +
          "test(\"x\", () => {});",
        filename,
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("unitTestImportsRenderer");
      expect(found[0].data).toEqual({
        specifier: "@testing-library/react",
        target: "agent-card.integration.test.tsx",
      });
      expect(found[0].message).toBe(
        "`@testing-library/react` is imported by a `.unit.test` file, and it renders components." +
          " Rename the file to `agent-card.integration.test.tsx` and leave the content unchanged.",
      );
    });
  });

  describe("when the import is type-only", () => {
    /** @scenario "A type-only testing-library import is left alone" */
    it("reports nothing", () => {
      expect(
        report(
          'import type { RenderResult } from "@testing-library/react";\ntest("x", () => {});',
          filename,
        ),
      ).toEqual([]);
    });
  });

  describe("when there is no testing-library import at all", () => {
    it("reports nothing", () => {
      expect(
        report(
          '// @vitest-environment jsdom\nimport { formatDate } from "../format-date";\ntest("x", () => {});',
          filename,
        ),
      ).toEqual([]);
    });
  });
});

describe("given a .integration.test.tsx file", () => {
  /** @scenario "An integration test importing testing-library is left alone" */
  it("reports nothing for the same testing-library import", () => {
    const found = report(
      'import { render } from "@testing-library/react";\ntest("x", () => {});',
      "modules/agent/web/src/ui/blocks/__tests__/agent-card.integration.test.tsx",
    );

    expect(found).toEqual([]);
  });
});
