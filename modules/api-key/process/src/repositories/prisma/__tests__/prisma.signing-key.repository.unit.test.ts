/**
 * @vitest-environment node
 * @see modules/api-key/specs/signing-keys.feature
 * The cipher double's output holds nothing of the plaintext: a secret in a row went in plain.
 */
import type { SharedCredentialCipher } from "@langwatch/secrets/shared-credential";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { fromDate } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { PrismaSigningKeyRepository } from "../prisma.signing-key.repository.ts";

/** The SDK's pinned test key (ADR-201 §4). */
const SECRET = "lwsk_testkid_testsecret";
const AT = fromDate(new Date("2026-10-22T00:00:00Z"));

function cipherDouble(): SharedCredentialCipher {
  const opened = new Map<string, string>();
  return {
    encrypt: (plaintext) => {
      const sealed = `sealed-${opened.size + 1}`;
      opened.set(sealed, plaintext);
      return sealed;
    },
    decrypt: (ciphertext) => {
      const plaintext = opened.get(ciphertext);
      if (plaintext === undefined) throw new Error(`the double never sealed ${ciphertext}`);
      return plaintext;
    },
  };
}

const storedRow = {
  id: "key-1",
  organizationId: "org-1",
  projectId: "project-1",
  name: "Production",
  publicId: "testkid",
  createdByUserId: "user-ana",
  createdAt: new Date("2026-10-21T12:00:00Z"),
  rotatedAt: null,
  verifiesUntil: null,
  revokedAt: null,
  lastUsedAt: null,
};

function repositoryOver() {
  const cipher = cipherDouble();
  const create = vi.fn(async (_args: { data: object; select?: object | null }) => storedRow);
  const credentialRow = (id: string, rest: { verifiesUntil?: Date; revokedAt?: Date } = {}) => ({
    id,
    projectId: "project-1",
    publicId: `kid-${id}`,
    secretCiphertext: cipher.encrypt(`${SECRET}-${id}`),
    verifiesUntil: rest.verifiesUntil ?? null,
    revokedAt: rest.revokedAt ?? null,
  });
  const findMany = vi.fn(async () => [
    {
      id: "key-1",
      projectId: "project-1",
      publicId: "testkid",
      secretCiphertext: cipher.encrypt(SECRET),
      verifiesUntil: null,
      revokedAt: null,
    },
    credentialRow("rotated-live", { verifiesUntil: new Date("2026-10-23T00:00:00Z") }),
    credentialRow("rotated-ended", { verifiesUntil: new Date("2026-10-21T00:00:00Z") }),
    credentialRow("revoked", { revokedAt: new Date("2026-10-20T00:00:00Z") }),
  ]);
  const database = prismaDouble({ signingKey: { create, findMany } });
  const repository = PrismaSigningKeyRepository.create({ prisma: database, cipher });
  return { repository, cipher, create };
}

describe("PrismaSigningKeyRepository", () => {
  describe("when a key is created", () => {
    /** @scenario "A signing key's secret is stored encrypted" */
    it("stores the secret only as the cipher's output and answers without it", async () => {
      const { repository, create } = repositoryOver();

      const answer = await repository.create({
        id: "key-1",
        organizationId: "org-1",
        projectId: "project-1",
        name: "Production",
        publicId: "testkid",
        secret: SECRET,
        createdByUserId: "user-ana",
      });

      const [args] = create.mock.calls[0] ?? [];
      expect(args?.data).toMatchObject({ secretCiphertext: "sealed-1" });
      expect(args?.data).not.toHaveProperty("secret");
      expect(JSON.stringify(args?.data)).not.toContain("testsecret");
      expect(args?.select).not.toHaveProperty("secretCiphertext");
      expect(JSON.stringify(answer)).not.toContain("testsecret");
      expect(answer).not.toHaveProperty("secretCiphertext");
    });
  });

  describe("when verification reads a key's credential", () => {
    it("opens the sealed secret through the cipher", async () => {
      const { repository } = repositoryOver();

      const [credential] = await repository.findCredentials({ organizationId: "org-1", at: AT });

      expect(credential?.secret).toBe(SECRET);
      expect(credential).not.toHaveProperty("secretCiphertext");
    });

    it("opens only keys that still verify, keeping the others' public id and status", async () => {
      const { repository, cipher } = repositoryOver();
      const decrypt = vi.spyOn(cipher, "decrypt");

      const credentials = await repository.findCredentials({ organizationId: "org-1", at: AT });

      expect(
        credentials.map(({ id, publicId, secret, revokedAt }) => ({
          id,
          publicId,
          opened: secret !== null,
          revoked: revokedAt !== null,
        })),
      ).toEqual([
        { id: "key-1", publicId: "testkid", opened: true, revoked: false },
        { id: "rotated-live", publicId: "kid-rotated-live", opened: true, revoked: false },
        { id: "rotated-ended", publicId: "kid-rotated-ended", opened: false, revoked: false },
        { id: "revoked", publicId: "kid-revoked", opened: false, revoked: true },
      ]);
      expect(decrypt).toHaveBeenCalledTimes(2);
    });

    describe("when one live key's secret will not open", () => {
      /** @scenario "One signing key whose secret will not open leaves the others verifying" */
      it("marks that key unreadable and still opens the other live key", async () => {
        const cipher = cipherDouble();
        const live = (id: string, secretCiphertext: string) => ({
          id,
          projectId: "project-1",
          publicId: `kid-${id}`,
          secretCiphertext,
          verifiesUntil: null,
          revokedAt: null,
        });
        const findMany = vi.fn(async () => [
          live("broken", "sealed-by-a-lost-key"),
          live("healthy", cipher.encrypt(SECRET)),
        ]);
        const repository = PrismaSigningKeyRepository.create({
          prisma: prismaDouble({ signingKey: { findMany } }),
          cipher,
        });

        const credentials = await repository.findCredentials({ organizationId: "org-1", at: AT });

        expect(
          credentials.map(({ id, secret, unreadable }) => ({ id, secret, unreadable })),
        ).toEqual([
          { id: "broken", secret: null, unreadable: true },
          { id: "healthy", secret: SECRET, unreadable: false },
        ]);
      });
    });
  });
});
