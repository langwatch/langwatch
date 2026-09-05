/**
 * The access-model reconciliation step embeds `LWQL_CLICKHOUSE_PASSWORD` in
 * the DDL it runs, and a ClickHouse error can echo that DDL back. `redactSecrets`
 * is the wrapper that keeps the password (and the admin connection string) out
 * of anything logged or re-thrown from that step.
 *
 * @see specs/analytics/lwql-api.feature
 */

import { describe, expect, it } from "vitest";

import {
  failClosedOnAccessModelReconciliation,
  redactSecrets,
} from "../provisionLwql";

describe("redactSecrets", () => {
  describe("given a message that echoes a secret", () => {
    describe("when the secret appears once", () => {
      it("replaces it with the marker", () => {
        const out = redactSecrets(
          "CREATE USER lwql IDENTIFIED BY 's3cr3t' failed",
          ["s3cr3t"],
        );
        expect(out).toBe("CREATE USER lwql IDENTIFIED BY '[REDACTED]' failed");
        expect(out).not.toContain("s3cr3t");
      });
    });

    describe("when the secret appears more than once", () => {
      it("replaces every occurrence", () => {
        const out = redactSecrets("s3cr3t and again s3cr3t", ["s3cr3t"]);
        expect(out).toBe("[REDACTED] and again [REDACTED]");
      });
    });

    describe("when several secrets are supplied", () => {
      it("redacts the password and the connection string together", () => {
        const out = redactSecrets(
          "clickhouse://user:p4ss@host/db rejected 's3cr3t'",
          ["s3cr3t", "clickhouse://user:p4ss@host/db"],
        );
        expect(out).not.toContain("s3cr3t");
        expect(out).not.toContain("p4ss");
      });
    });
  });

  describe("given empty or undefined secrets", () => {
    it("leaves the message untouched and never matches an empty string", () => {
      expect(redactSecrets("nothing to hide", [undefined, ""])).toBe(
        "nothing to hide",
      );
    });
  });
});

describe("failClosedOnAccessModelReconciliation", () => {
  describe("given a reconciliation error that echoes the password", () => {
    describe("when the failure is handled", () => {
      /** @scenario "A failed access-model reconciliation aborts the deploy without leaking the password" */
      it("aborts the deploy rather than continuing", () => {
        expect(() =>
          failClosedOnAccessModelReconciliation({
            error: new Error("boom"),
            secrets: [],
          }),
        ).toThrow();
      });

      /** @scenario "A failed access-model reconciliation aborts the deploy without leaking the password" */
      it("re-throws with the password and connection string redacted", () => {
        let thrown: unknown;
        try {
          failClosedOnAccessModelReconciliation({
            error: new Error(
              "CREATE USER lwql IDENTIFIED BY 's3cr3t' at clickhouse://u:p4ss@h/db failed",
            ),
            secrets: ["s3cr3t", "clickhouse://u:p4ss@h/db"],
          });
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(Error);
        const message = (thrown as Error).message;
        expect(message).not.toContain("s3cr3t");
        expect(message).not.toContain("p4ss");
      });
    });
  });
});
