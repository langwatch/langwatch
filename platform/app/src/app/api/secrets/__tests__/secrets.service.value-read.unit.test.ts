/**
 * Spec: specs/secrets/secret-value-read.feature
 */

import type { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import { encrypt } from "~/utils/encryption";
import { SecretsService } from "../secrets.service";

function serviceHolding(
  row: {
    name: string;
    encryptedValue: string;
  } | null,
) {
  const service = new SecretsService({} as PrismaClient);
  // The repository is the only collaborator this read has, so replacing it
  // keeps the test on the service's own decisions.
  (service as unknown as { repo: unknown }).repo = {
    findValueByNameInProject: () =>
      Promise.resolve(
        row
          ? {
              id: "secret-1",
              projectId: "project-1",
              name: row.name,
              encryptedValue: row.encryptedValue,
              createdAt: new Date(0),
              updatedAt: new Date(0),
            }
          : null,
      ),
  };
  return service;
}

describe("SecretsService.getValueByName", () => {
  describe("when the stored value cannot be decrypted", () => {
    /** @scenario "A value the platform can no longer decrypt is named as unreadable" */
    it("names it unreadable and records a platform fault", async () => {
      const service = serviceHolding({
        name: "ACME_SESSION",
        encryptedValue: "not-a-valid-envelope",
      });

      const error = await service
        .getValueByName({ projectId: "project-1", name: "ACME_SESSION" })
        .then(
          () => null,
          (thrown: unknown) => thrown,
        );

      const handled = error as HandledError;
      expect(handled.code).toBe("secret_value_unreadable");
      expect(handled.fault).toBe("platform");
    });
  });

  describe("when the project holds the secret", () => {
    it("returns the decrypted value", async () => {
      const service = serviceHolding({
        name: "ACME_SESSION",
        encryptedValue: encrypt("session-1"),
      });

      const result = await service.getValueByName({
        projectId: "project-1",
        name: "ACME_SESSION",
      });

      expect(result.value).toBe("session-1");
      expect(result.name).toBe("ACME_SESSION");
    });
  });
});
