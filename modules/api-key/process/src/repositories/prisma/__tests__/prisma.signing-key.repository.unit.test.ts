/**
 * @vitest-environment node
 * @see modules/api-key/specs/signing-keys.feature
 * The cipher double's output holds nothing of the plaintext: a secret in a row went in plain.
 */
import type { SharedCredentialCipher } from "@langwatch/secrets/shared-credential";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { PrismaSigningKeyRepository } from "../prisma.signing-key.repository.ts";

/** The SDK's pinned test key (ADR-183 §4). */
const SECRET = "lwsk_testkid_testsecret";

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
  const findMany = vi.fn(async () => [
    {
      id: "key-1",
      projectId: "project-1",
      publicId: "testkid",
      secretCiphertext: cipher.encrypt(SECRET),
      verifiesUntil: null,
      revokedAt: null,
    },
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

      const [credential] = await repository.findCredentials({
        organizationId: "org-1",
        publicId: "testkid",
      });

      expect(credential?.secret).toBe(SECRET);
      expect(credential).not.toHaveProperty("secretCiphertext");
    });
  });
});
