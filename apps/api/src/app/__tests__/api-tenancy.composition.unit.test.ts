/**
 * Spec: specs/server/api-process-tenancy.feature
 */
import { PostgresApiKeyAdapter } from "@langwatch/api-key-server";
import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import { PrismaConnection } from "@langwatch/prisma-client";
import { AesGcmSecretEncryptionAdapter } from "@langwatch/secret-server";
import { describe, expect, it, vi } from "vitest";
import { ApiOrganizationSettingsSecretAdapter } from "../api-organization-settings-secret.adapter";
import { ApiTenancyAbsenceReportPort, ApiTenancyComposition } from "../api-tenancy.composition";

const ENCRYPTION_KEY = "0f".repeat(32);
const PEPPER = "  a-pepper-with-surrounding-space  ";

/** A client whose delegates exist and whose statements refuse; see the AuthZ suite. */
function stubConnection(): PrismaConnection {
  const refusingStatement = () => {
    throw new Error("Composing the tenancy services must not query the database.");
  };
  const delegate = new Proxy({}, { get: () => refusingStatement });
  const client = new Proxy({}, { get: () => delegate });
  return PrismaConnection.create({ client: client as never, pool: client as never });
}

function stubAuthz(): { permissions: AuthzService; grants: AuthzGrantsService } {
  return {
    permissions: new Proxy({}, {}) as AuthzService,
    grants: new Proxy({}, {}) as AuthzGrantsService,
  };
}

function encryption() {
  return AesGcmSecretEncryptionAdapter.create({ key: ENCRYPTION_KEY });
}

class RecordingAbsence extends ApiTenancyAbsenceReportPort {
  readonly reasons: string[] = [];

  absent(reason: "no-database" | "no-authz" | "no-pepper"): void {
    this.reasons.push(reason);
  }
}

describe("ApiTenancyComposition", () => {
  describe("when the process has a database, AuthZ, a cipher and a pepper", () => {
    /** @scenario "The API process composes its own organization and API-key services" */
    it("composes the organization, project and API-key services as one graph", () => {
      const composed = ApiTenancyComposition.compose({
        database: stubConnection(),
        authz: stubAuthz(),
        encryption: encryption(),
        pepper: "a-pepper",
      });

      expect(composed.organizations).toBeDefined();
      expect(composed.projects).toBeDefined();
      expect(composed.apiKeys).toBeDefined();
    });

    // The pepper is an HMAC key over a persisted hash, not a secret to be
    // decoded: a process that peppered with the cipher's decoded bytes would
    // hash every presented credential differently and authenticate none of the
    // keys a customer already holds. Trimming is the only thing done to it, and
    // only because a configured value's surrounding whitespace is not part of
    // the operator's intent.
    /** @scenario "The API-key pepper reaches the service verbatim" */
    it("hands the API-key service the configured pepper and nothing derived from it", () => {
      const create = vi.spyOn(PostgresApiKeyAdapter, "create");

      ApiTenancyComposition.tryCompose({
        database: stubConnection(),
        authz: stubAuthz(),
        encryption: encryption(),
        pepper: PEPPER,
        report: new RecordingAbsence(),
      });

      expect(create.mock.calls[0]![0].pepper).toBe(PEPPER.trim());
      expect(create.mock.calls[0]![0].pepper).not.toBe(ENCRYPTION_KEY);
      create.mockRestore();
    });
  });

  describe("when the process is missing one of the four", () => {
    /** @scenario "A process missing any of the four composes no credential services" */
    it("composes nothing without a database, and names what was missing", () => {
      const report = new RecordingAbsence();

      const composed = ApiTenancyComposition.tryCompose({
        database: undefined,
        authz: stubAuthz(),
        encryption: encryption(),
        pepper: "a-pepper",
        report,
      });

      expect(composed).toBeUndefined();
      expect(report.reasons).toEqual(["no-database"]);
    });

    /** @scenario "A process missing any of the four composes no credential services" */
    it("composes nothing without AuthZ, and names what was missing", () => {
      const report = new RecordingAbsence();

      const composed = ApiTenancyComposition.tryCompose({
        database: stubConnection(),
        authz: undefined,
        encryption: encryption(),
        pepper: "a-pepper",
        report,
      });

      expect(composed).toBeUndefined();
      expect(report.reasons).toEqual(["no-authz"]);
    });

    // A blank pepper is not a weaker service: it is one that hashes every
    // presented credential under a different key.
    /** @scenario "A process missing any of the four composes no credential services" */
    it("composes nothing for a blank pepper rather than one that locks every key out", () => {
      const report = new RecordingAbsence();

      const composed = ApiTenancyComposition.tryCompose({
        database: stubConnection(),
        authz: stubAuthz(),
        encryption: encryption(),
        pepper: "   ",
        report,
      });

      expect(composed).toBeUndefined();
      expect(report.reasons).toEqual(["no-pepper"]);
    });
  });
});

describe("ApiOrganizationSettingsSecretAdapter", () => {
  describe("given the cipher the stored-secret family runs under", () => {
    /** @scenario "Organization settings are encrypted by the process's one cipher" */
    it("writes settings the same cipher reads back", () => {
      const cipher = encryption();
      const settings = ApiOrganizationSettingsSecretAdapter.create({ encryption: cipher });

      const written = settings.encrypt("a-stored-setting");

      expect(written).not.toBe("a-stored-setting");
      expect(cipher.decrypt(written)).toBe("a-stored-setting");
      expect(settings.decrypt(cipher.encrypt("a-stored-setting"))).toBe("a-stored-setting");
    });
  });
});
