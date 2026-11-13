import { afterAll, describe, expect, it } from "vitest";

import { ingestionSourceStatusLiteralRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(ingestionSourceStatusLiteralRule, { code, cwd: workspace.cwd, filename });
}

const PROCESS =
  "enterprise/modules/governance/process/src/features/ingest/services/door.service.ts";
const BROWSER = "enterprise/modules/governance/browser/src/features/ingestion-sources/badge.ts";
const DISABLED_CHECK = 'export const live = (source) => source.status !== "disabled";';

describe("given governance production code", () => {
  describe('when a source status is compared with "disabled"', () => {
    /** @scenario "A source status compared with the disabled state is reported" */
    it("reports statusLiteral and names the liveness rule to call", () => {
      const found = report(DISABLED_CHECK, PROCESS);

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("statusLiteral");
      expect(found[0].data).toEqual({ state: "disabled", path: PROCESS });
      expect(found[0].message).toContain("ingestionSourceIsLive(source)");
    });
  });

  describe("when liveness is spelled as active or awaiting its first event", () => {
    /** @scenario "The positive spelling of liveness is reported" */
    it('reports the "awaiting_first_event" comparison', () => {
      const found = report(
        'export const live = (s) => s.status === "active" || "awaiting_first_event" === s.status;',
        PROCESS,
      );

      expect(found.map((finding) => finding.data.state)).toEqual(["awaiting_first_event"]);
    });
  });

  describe("when browser code compares a bare status variable", () => {
    /** @scenario "A bare status variable is reported in browser code too" */
    it("reports statusLiteral", () => {
      const found = report('export const off = (status) => status === "disabled";', BROWSER);

      expect(found.map((finding) => finding.messageId)).toEqual(["statusLiteral"]);
    });
  });
});

describe("given code the rule does not govern", () => {
  /** @scenario "The liveness file, anomaly rules, tests and other modules are left alone" */
  it.each([
    [
      "the liveness file",
      "enterprise/modules/governance/contract/src/features/ingestion/source-health.ts",
    ],
    [
      "an anomaly rule file",
      "enterprise/modules/governance/process/src/services/anomaly-rule.service.ts",
    ],
    [
      "a governance test",
      "enterprise/modules/governance/process/src/features/ingest/services/__tests__/door.unit.test.ts",
    ],
    ["another module", "enterprise/modules/sso/process/src/services/sso.service.ts"],
  ])("reports nothing in %s", (_label, filename) => {
    expect(report(DISABLED_CHECK, PROCESS)).toHaveLength(1);
    expect(report(DISABLED_CHECK, filename)).toEqual([]);
  });
});

describe("given a comparison that is not a source state", () => {
  /** @scenario "A status that is not a source state is left alone" */
  it("reports nothing", () => {
    const found = report(
      'export const a = (s) => s.status === "active";\nexport const b = (r) => r.kind === "disabled";',
      PROCESS,
    );

    expect(report(DISABLED_CHECK, PROCESS)).toHaveLength(1);
    expect(found).toEqual([]);
  });
});
