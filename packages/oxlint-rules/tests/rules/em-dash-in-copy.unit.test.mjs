import { afterAll, describe, expect, it } from "vitest";

import { emDashInCopyRule } from "../../src/rules/em-dash-in-copy.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(emDashInCopyRule, { code, cwd: workspace.cwd, filename });
}

describe("given customer-facing tsx in apps/ui/src", () => {
  const filename = "apps/ui/src/features/agent/ui/agent-card.tsx";

  describe("when JSX text carries an em dash between words", () => {
    /** @scenario "An em dash inside JSX prose is reported" */
    it("reports emDashInCopy with the excerpt", () => {
      const found = report(
        "export function AgentCard() { return <p>Your changes were saved — refresh to see them.</p>; }",
        filename,
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("emDashInCopy");
      expect(found[0].data.excerpt).toContain("—");
      expect(found[0].data.excerpt).toContain("saved");
    });
  });

  describe("when a template literal quasi carries an em dash", () => {
    it("reports emDashInCopy for the quasi alone", () => {
      const found = report(
        "export function retryMessage(count: number) { return `Retry attempt ${count} — please wait`; }",
        filename,
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("emDashInCopy");
    });
  });

  describe("when JSX text is only the em dash placeholder", () => {
    /** @scenario "A lone em dash table placeholder is left alone" */
    it("reports nothing", () => {
      expect(report("export function Cell() { return <td>—</td>; }", filename)).toEqual([]);
    });
  });

  describe("when a string literal has no letters around the dash", () => {
    it("reports nothing", () => {
      expect(report('export const range = "123—456";', filename)).toEqual([]);
    });
  });
});

describe("given a module's web package", () => {
  describe("when a tooltip string literal carries an em dash", () => {
    /** @scenario "An em dash in a tooltip string is reported" */
    it("reports emDashInCopy", () => {
      const found = report(
        'export const helpText = { tooltip: "Detects emails, phones — and more" };',
        "modules/widget/browser/src/components/widget-help.tsx",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("emDashInCopy");
    });
  });
});

describe("given the same em-dash copy outside customer-facing tsx", () => {
  const code = 'export const helpText = { tooltip: "Detects emails, phones — and more" };';

  describe("when the file is a .test.tsx", () => {
    it("reports nothing", () => {
      expect(report(code, "apps/ui/src/features/agent/ui/agent-card.test.tsx")).toEqual([]);
    });
  });

  describe("when the file is in a module's server package", () => {
    /** @scenario "Server code is outside the rule" */
    it("reports nothing", () => {
      expect(report(code, "modules/widget/process/src/widget-help.tsx")).toEqual([]);
    });
  });
});
