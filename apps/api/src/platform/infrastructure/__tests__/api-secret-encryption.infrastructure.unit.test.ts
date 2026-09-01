import { describe, expect, it } from "vitest";
import {
  ApiSecretEncryptionAbsenceReportPort,
  ApiSecretEncryptionInfrastructure,
} from "../api-secret-encryption.infrastructure";

const KEY = "0f".repeat(32);

class RecordedAbsence extends ApiSecretEncryptionAbsenceReportPort {
  calls = 0;

  absent(): void {
    this.calls += 1;
  }
}

describe("ApiSecretEncryptionInfrastructure", () => {
  describe("given a deployment that configured no key", () => {
    /** @scenario "A process with no key composes no secret service" */
    it("composes nothing and says so, rather than refusing the boot", () => {
      const report = new RecordedAbsence();

      const infrastructure = ApiSecretEncryptionInfrastructure.tryCreate({
        key: undefined,
        report,
      });

      expect(infrastructure).toBeUndefined();
      expect(report.calls).toBe(1);
    });

    it("treats a variable exported blank as unconfigured, not as a key", () => {
      const report = new RecordedAbsence();

      const infrastructure = ApiSecretEncryptionInfrastructure.tryCreate({
        key: "   \t \n ",
        report,
      });

      expect(infrastructure).toBeUndefined();
      expect(report.calls).toBe(1);
    });

    it("refuses an explicit construction instead of handing back a cipher with no key", () => {
      expect(() => ApiSecretEncryptionInfrastructure.create({ key: undefined })).toThrow(
        /CREDENTIALS_SECRET/,
      );
      expect(() => ApiSecretEncryptionInfrastructure.create({ key: "  " })).toThrow(
        /CREDENTIALS_SECRET/,
      );
    });
  });

  describe("given a key that is configured but unusable", () => {
    /** @scenario "A key that is not the key refuses rather than guesses" */
    it("fails at boot rather than at the first secret a customer reads", () => {
      expect(() => ApiSecretEncryptionInfrastructure.tryCreate({ key: "0f".repeat(16) })).toThrow(
        /32-byte hex key/,
      );
      expect(() => ApiSecretEncryptionInfrastructure.tryCreate({ key: "nonsense" })).toThrow(
        /32-byte hex key/,
      );
    });
  });

  describe("given a configured key", () => {
    it("composes the packaged cipher, which round-trips a stored value", () => {
      const infrastructure = ApiSecretEncryptionInfrastructure.create({ key: KEY });

      const encrypted = infrastructure.encryption.encrypt("sk-live-abc123");

      expect(encrypted).not.toContain("sk-live-abc123");
      expect(infrastructure.encryption.decrypt(encrypted)).toBe("sk-live-abc123");
    });

    it("reads a value the surrounding whitespace of the export would otherwise change", () => {
      const padded = ApiSecretEncryptionInfrastructure.create({ key: `  ${KEY}\n` });
      const exact = ApiSecretEncryptionInfrastructure.create({ key: KEY });

      expect(exact.encryption.decrypt(padded.encryption.encrypt("value"))).toBe("value");
    });
  });
});
