import { afterAll, describe, expect, it } from "vitest";

import { skipTenantCheckReasonRule } from "../../src/rules/skip-tenant-check-reason.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
});

afterAll(() => workspace.cleanup());

const FILE = "modules/agent/process/src/repositories/clickhouse/clickhouse.agent-run.repository.ts";
// Built from parts so this file carries no retired marker of its own.
const RETIRED = "-- " + "@tenancy:";

function report(code) {
  return runRule(skipTenantCheckReasonRule, { code, cwd: workspace.cwd, filename: FILE }).map(
    ({ messageId }) => messageId,
  );
}

const statement = (...flagLines) =>
  [
    "await client.query({",
    '  tenantId: "",',
    '  sql: "SELECT count() FROM system.parts",',
    ...flagLines,
    "});",
  ].join("\n");

describe("given a statement that sets SKIP_TENANT_CHECK", () => {
  describe("when a real reason sits directly above the flag", () => {
    /** @scenario "A skipped tenant check with a real reason above it is left alone" */
    it("reports nothing for a line comment, a run of them, a block comment or a constant", () => {
      expect(
        report(
          statement(
            "  // system.parts carries no tenant column at all.",
            "  SKIP_TENANT_CHECK: true,",
          ),
        ),
      ).toEqual([]);
      expect(
        report(
          statement(
            "  // The stalled-run sweep spans every tenant",
            "  // on this install, by design.",
            "  SKIP_TENANT_CHECK: true,",
          ),
        ),
      ).toEqual([]);
      expect(
        report(
          statement(
            "  /* The replica layout describes the server, which no tenant owns. */",
            "  SKIP_TENANT_CHECK: true,",
          ),
        ),
      ).toEqual([]);
      expect(
        report(
          [
            "// The upgrade ledger describes the installation, not a tenant.",
            "const LEDGER = skipTenantCheck({ SKIP_TENANT_CHECK: true }).sql;",
          ].join("\n"),
        ),
      ).toEqual([]);
    });
  });

  describe("when the comment is missing, short, a placeholder or not directly above", () => {
    /** @scenario "A skipped tenant check without a real reason is reported" */
    it("reports missingReason", () => {
      expect(report(statement("  SKIP_TENANT_CHECK: true,"))).toEqual(["missingReason"]);
      expect(report(statement("  // system table", "  SKIP_TENANT_CHECK: true,"))).toEqual([
        "missingReason",
      ]);
      expect(
        report(
          statement("  // TODO: work out why this needs to skip", "  SKIP_TENANT_CHECK: true,"),
        ),
      ).toEqual(["missingReason"]);
      expect(
        report(
          statement("  // tests only, nothing to see here at all", "  SKIP_TENANT_CHECK: true,"),
        ),
      ).toEqual(["missingReason"]);
      expect(
        report(
          statement(
            "  // system.parts carries no tenant column at all.",
            "",
            "  SKIP_TENANT_CHECK: true,",
          ),
        ),
      ).toEqual(["missingReason"]);
    });

    it("leaves a flag that is not literally true to the statement that sets it", () => {
      expect(report(statement("  SKIP_TENANT_CHECK: input.SKIP_TENANT_CHECK,"))).toEqual([]);
    });
  });
});

describe("given a retired opt-out", () => {
  describe("when a statement carries unscoped", () => {
    /** @scenario "The retired unscoped opt-out is reported" */
    it("reports retiredUnscoped", () => {
      expect(
        report(statement('  unscoped: { reason: "system.parts carries no tenant column" },')),
      ).toEqual(["retiredUnscoped"]);
      expect(report(statement("  unscoped: UNSCOPED,"))).toEqual(["retiredUnscoped"]);
    });

    it("leaves an unrelated unscoped property alone", () => {
      expect(report("const view = { unscoped: true, label: 'all' };")).toEqual([]);
    });
  });

  describe("when SQL carries the retired comment", () => {
    /** @scenario "The retired tenancy comment is reported" */
    it("reports retiredTenancyComment in a string and in a template", () => {
      expect(
        report(`await db.$executeRawUnsafe(${JSON.stringify(`${RETIRED} sweep\nSELECT 1`)});`),
      ).toEqual(["retiredTenancyComment"]);
      expect(report(`await db.$executeRaw\`\n  ${RETIRED} a sweep\n  SELECT 1\n\`;`)).toEqual([
        "retiredTenancyComment",
      ]);
    });
  });
});
