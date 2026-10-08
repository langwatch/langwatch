/**
 * AC5: the summariser the provisioning error logs run through
 * (`clickHouseErrorSummary`) drops the statement text and any embedded secret,
 * so no provisioning log line or thrown error can carry them. selfProvisioning
 * and reconvergence both log `clickHouseErrorSummary(error)`, never the raw
 * error.
 *
 * @see ../clickhouseStatementRunner.ts — clickHouseErrorSummary
 * @see ../selfProvisioning.ts — probeAppFunctionStore error log
 * @see ../reconvergence.ts — probe / converge error logs
 */

import { describe, expect, it } from "vitest";

import { clickHouseErrorSummary } from "../clickhouseStatementRunner";

const SECRET = "s3cr3t-lwql-password";
const STATEMENT = `CREATE USER OR REPLACE langwatch_lwql IDENTIFIED WITH sha256_password BY '${SECRET}' SETTINGS PROFILE p`;

describe("clickHouseErrorSummary", () => {
  describe("when a ClickHouse error embeds the failing statement and its password", () => {
    /** @scenario "No provisioning log line or thrown error contains SQL statement text" */
    it("summarises to the code and type only, never the statement or the secret", () => {
      const error = Object.assign(
        new Error(
          `Code: 516. Authentication failed while running: ${STATEMENT}`,
        ),
        { code: 516 },
      );

      const summary = clickHouseErrorSummary(error);
      const serialised = JSON.stringify(summary);

      expect(summary.code).toBe(516);
      expect(serialised).not.toContain(SECRET);
      expect(serialised).not.toContain("CREATE USER");
      expect(serialised).not.toContain("sha256_password");
    });
  });

  describe("when a non-ClickHouse error carries the statement in its message", () => {
    it("keeps only safe system primitives, never the message", () => {
      const error = Object.assign(new Error(STATEMENT), {
        code: "ECONNREFUSED",
        syscall: "connect",
      });

      const serialised = JSON.stringify(clickHouseErrorSummary(error));

      expect(serialised).toContain("ECONNREFUSED");
      expect(serialised).not.toContain(SECRET);
      expect(serialised).not.toContain("CREATE USER");
    });
  });
});
