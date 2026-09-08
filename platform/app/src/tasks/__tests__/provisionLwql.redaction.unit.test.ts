/**
 * The self-provisioning path embeds the restricted identity's password and the
 * PostgreSQL reader password in the DDL it runs, and a ClickHouse error echoes
 * the statement that failed. `redactSecrets` is what every logged provisioning
 * error goes through so neither secret, nor the connection strings, reaches
 * the log.
 *
 * @see specs/analytics/lwql-api.feature
 */

import { describe, expect, it } from "vitest";

import { redactSecrets } from "../provisionLwql";

describe("redactSecrets", () => {
  describe("given a message that echoes a secret", () => {
    describe("when the secret appears once", () => {
      /** @scenario "A failed self-provisioning run is logged without leaking a password" */
      it("replaces it with the marker", () => {
        const out = redactSecrets(
          "CREATE USER lwql IDENTIFIED WITH sha256_password BY 's3cr3t' failed",
          ["s3cr3t"],
        );
        expect(out).toBe(
          "CREATE USER lwql IDENTIFIED WITH sha256_password BY '[REDACTED]' failed",
        );
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
      /** @scenario "A failed self-provisioning run is logged without leaking a password" */
      it("redacts the passwords and the connection strings together", () => {
        const out = redactSecrets(
          "clickhouse://user:p4ss@host/db rejected 's3cr3t' dialling postgresql://ro:pgpw@pg/app",
          [
            "s3cr3t",
            "pgpw",
            "clickhouse://user:p4ss@host/db",
            "postgresql://ro:pgpw@pg/app",
          ],
        );
        expect(out).not.toContain("s3cr3t");
        expect(out).not.toContain("p4ss");
        expect(out).not.toContain("pgpw");
      });
    });

    describe("when a secret contains regexp metacharacters", () => {
      it("matches it literally", () => {
        const out = redactSecrets("password 'a.b*c+(d)' rejected", [
          "a.b*c+(d)",
        ]);
        expect(out).toBe("password '[REDACTED]' rejected");
      });
    });
  });

  describe("given empty or undefined secrets", () => {
    /** @scenario "A failed self-provisioning run is logged without leaking a password" */
    it("leaves the message untouched and never matches an empty string", () => {
      expect(redactSecrets("nothing to hide", [undefined, ""])).toBe(
        "nothing to hide",
      );
    });
  });
});
