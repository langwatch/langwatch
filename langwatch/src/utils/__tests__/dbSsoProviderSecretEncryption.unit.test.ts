import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Reversible, hex-shaped fakes so the middleware's `isCiphertext` gate (which
// matches `hex:hex:hex`) behaves exactly as with the real AES-GCM output,
// without depending on a configured CREDENTIALS_SECRET.
vi.mock("../encryption", () => ({
  encrypt: (text: string) =>
    `${Buffer.from(text, "utf8").toString("hex")}:abcd:ef01`,
  decrypt: (value: string) =>
    Buffer.from(value.split(":")[0]!, "hex").toString("utf8"),
}));

import { encryptSsoProviderSecrets } from "../dbSsoProviderSecretEncryption";

const run = (params: Partial<Prisma.MiddlewareParams>, next: any) =>
  encryptSsoProviderSecrets(
    {
      model: "SsoProvider",
      action: "create",
      args: {},
      dataPath: [],
      runInTransaction: false,
      ...params,
    } as Prisma.MiddlewareParams,
    next,
  );

const PLAINTEXT_OIDC = JSON.stringify({ clientId: "x", clientSecret: "s3cret" });

describe("encryptSsoProviderSecrets", () => {
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Real Prisma echoes back a fresh row object, distinct from args.data.
    // Cloning keeps the captured input (encrypted) separate from the returned
    // result (which the middleware decrypts).
    next = vi.fn(async (p: Prisma.MiddlewareParams) =>
      p.args?.data ? structuredClone(p.args.data) : null,
    );
  });

  describe("given a create on SsoProvider with secret config", () => {
    it("encrypts oidcConfig before it reaches the database", async () => {
      const args = { data: { domain: "acme.com", oidcConfig: PLAINTEXT_OIDC } };
      await run({ action: "create", args }, next);

      const persisted = (next.mock.calls[0]![0] as Prisma.MiddlewareParams).args!
        .data.oidcConfig as string;
      expect(persisted).not.toContain("s3cret");
      expect(persisted).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    });

    it("returns the row with oidcConfig decrypted back to plaintext", async () => {
      const args = { data: { domain: "acme.com", oidcConfig: PLAINTEXT_OIDC } };
      const result = await run({ action: "create", args }, next);
      expect((result as { oidcConfig: string }).oidcConfig).toBe(PLAINTEXT_OIDC);
    });

    it("encrypts samlConfig private keys too", async () => {
      const samlPlaintext = JSON.stringify({ privateKey: "PRIVATE_KEY_PEM" });
      const args = { data: { domain: "acme.com", samlConfig: samlPlaintext } };
      await run({ action: "create", args }, next);
      const persisted = (next.mock.calls[0]![0] as Prisma.MiddlewareParams).args!
        .data.samlConfig as string;
      expect(persisted).not.toContain("PRIVATE_KEY_PEM");
    });
  });

  describe("given a findMany on SsoProvider", () => {
    it("decrypts every returned row's config", async () => {
      const encrypted = `${Buffer.from(PLAINTEXT_OIDC, "utf8").toString("hex")}:abcd:ef01`;
      next = vi.fn(async () => [
        { id: "1", oidcConfig: encrypted },
        { id: "2", oidcConfig: encrypted },
      ]);
      const rows = (await run({ action: "findMany", args: { where: {} } }, next)) as Array<{
        oidcConfig: string;
      }>;
      expect(rows[0]!.oidcConfig).toBe(PLAINTEXT_OIDC);
      expect(rows[1]!.oidcConfig).toBe(PLAINTEXT_OIDC);
    });
  });

  describe("given an already-encrypted value on write", () => {
    it("does not double-encrypt (idempotent)", async () => {
      const alreadyCipher = `${Buffer.from(PLAINTEXT_OIDC, "utf8").toString("hex")}:abcd:ef01`;
      const args = { data: { oidcConfig: alreadyCipher }, where: { id: "1" } };
      await run({ action: "update", args }, next);
      const persisted = (next.mock.calls[0]![0] as Prisma.MiddlewareParams).args!
        .data.oidcConfig as string;
      expect(persisted).toBe(alreadyCipher);
    });
  });

  describe("given a plaintext (non-ciphertext) value on read", () => {
    it("passes it through untouched", async () => {
      next = vi.fn(async () => ({ id: "1", oidcConfig: PLAINTEXT_OIDC }));
      const row = (await run({ action: "findFirst", args: { where: {} } }, next)) as {
        oidcConfig: string;
      };
      expect(row.oidcConfig).toBe(PLAINTEXT_OIDC);
    });
  });

  describe("given a different model", () => {
    it("leaves the query untouched", async () => {
      const args = { data: { oidcConfig: PLAINTEXT_OIDC } };
      await run({ model: "User", action: "create", args }, next);
      const passed = (next.mock.calls[0]![0] as Prisma.MiddlewareParams).args!.data
        .oidcConfig as string;
      expect(passed).toBe(PLAINTEXT_OIDC);
    });
  });
});
