import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SIGN_UP_VERIFICATION_TTL_MS,
  SignUpVerificationService,
} from "../signup-verification.service";

/**
 * Sign-up's address confirmation (D13, ADR-117 §6). The service is composed
 * from ports, so the whole flow runs here with no datastore and no mailer.
 */
const NOW = new Date("2026-08-24T12:00:00.000Z");

/** Stands in for bcrypt: what matters is that it is not the password. */
const FAKE_PASSWORD_HASH = "$2b$10$notthepassword";

function makeService({ registered = false }: { registered?: boolean } = {}) {
  const issued: Array<{ identifier: string; token: string; expires: Date }> =
    [];
  const sent: Array<{ email: string; verificationUrl: string }> = [];
  const created: Array<{ email: string; passwordHash: string }> = [];
  let addressIsTaken = registered;

  const service = new SignUpVerificationService({
    tokens: {
      issue: async (record) => {
        issued.push(record);
      },
      claim: async ({ token, now }) => {
        const index = issued.findIndex((record) => record.token === token);
        if (index === -1) return null;
        const [record] = issued.splice(index, 1);
        if (!record || record.expires <= now) return null;
        return { identifier: record.identifier };
      },
    },
    mailer: {
      sendVerificationLink: async (message) => {
        sent.push(message);
      },
    },
    directory: { hasAccountFor: async () => addressIsTaken },
    accounts: {
      createCredentialAccount: async (account) => {
        created.push(account);
        addressIsTaken = true;
      },
    },
    hashPassword: async () => FAKE_PASSWORD_HASH,
    buildVerificationUrl: ({ token }) =>
      `https://app.test/auth/signup?verify=${token}`,
    now: () => NOW,
    mintToken: vi.fn(() => "token-1"),
  });

  return {
    service,
    issued,
    sent,
    created,
    takeAddress: () => {
      addressIsTaken = true;
    },
  };
}

describe("given a sign-up address to confirm", () => {
  let harness: ReturnType<typeof makeService>;

  beforeEach(() => {
    harness = makeService();
  });

  describe("when the address is submitted", () => {
    it("emails a link that expires, and creates nothing else", async () => {
      await harness.service.requestVerification({ email: "Sam@Acme.com" });

      expect(harness.sent).toHaveLength(1);
      expect(harness.sent[0]?.email).toBe("sam@acme.com");
      expect(harness.sent[0]?.verificationUrl).toContain("token-1");
      expect(harness.issued[0]?.expires).toEqual(
        new Date(NOW.getTime() + SIGN_UP_VERIFICATION_TTL_MS),
      );
    });

    it("normalizes the address the way an attach does", async () => {
      await harness.service.requestVerification({ email: " Sam@Acme.com " });
      const { email } = await harness.service.completeVerification({
        token: "token-1",
      });

      expect(email).toBe("sam@acme.com");
    });
  });

  describe("when the emailed link comes back", () => {
    it("confirms the address once and never again", async () => {
      await harness.service.requestVerification({ email: "sam@acme.com" });

      await expect(
        harness.service.completeVerification({ token: "token-1" }),
      ).resolves.toEqual({ email: "sam@acme.com", accountCreated: false });

      await expect(
        harness.service.completeVerification({ token: "token-1" }),
      ).rejects.toMatchObject({ code: "identity_verification_expired" });
    });
  });

  describe("when the link never existed or has expired", () => {
    it("refuses both the same way", async () => {
      await expect(
        harness.service.completeVerification({ token: "never-issued" }),
      ).rejects.toMatchObject({ code: "identity_verification_expired" });
    });

    it("refuses a token minted for something other than a sign-up", async () => {
      harness.issued.push({
        identifier: "password-reset:sam@acme.com",
        token: "borrowed",
        expires: new Date(NOW.getTime() + 1000),
      });

      await expect(
        harness.service.completeVerification({ token: "borrowed" }),
      ).rejects.toMatchObject({ code: "identity_verification_expired" });
    });
  });

  describe("when the address already has an account", () => {
    it("says so, which is the door back into a half-created account", async () => {
      const registered = makeService({ registered: true });

      await expect(
        registered.service.addressIsRegistered({ email: "sam@acme.com" }),
      ).resolves.toBe(true);
    });
  });

  describe("when a password is typed for an address nobody holds", () => {
    it("holds the credential as a hash and sends a confirmation link", async () => {
      await expect(
        harness.service.startPasswordSignUp({
          email: "sam@acme.com",
          password: "correct horse",
        }),
      ).resolves.toEqual({ outcome: "verification_sent" });

      expect(harness.sent).toHaveLength(1);
      expect(harness.created).toHaveLength(0);
      // The password itself is nowhere: only its hash was written down.
      expect(harness.issued[0]?.identifier).not.toContain("correct horse");
      expect(harness.issued[0]?.identifier).toContain(FAKE_PASSWORD_HASH);
    });

    it("creates the account when the link comes back", async () => {
      await harness.service.startPasswordSignUp({
        email: "sam@acme.com",
        password: "correct horse",
      });

      await expect(
        harness.service.completeVerification({ token: "token-1" }),
      ).resolves.toEqual({ email: "sam@acme.com", accountCreated: true });
      expect(harness.created).toEqual([
        { email: "sam@acme.com", passwordHash: FAKE_PASSWORD_HASH },
      ]);
    });

    it("creates nothing when the address gained an account meanwhile", async () => {
      await harness.service.startPasswordSignUp({
        email: "sam@acme.com",
        password: "correct horse",
      });
      harness.takeAddress();

      await expect(
        harness.service.completeVerification({ token: "token-1" }),
      ).resolves.toEqual({ email: "sam@acme.com", accountCreated: false });
      expect(harness.created).toHaveLength(0);
    });
  });

  describe("when a password is typed for an address that does have an account", () => {
    it("says so and sends nothing, so a wrong password stays a wrong password", async () => {
      const registered = makeService({ registered: true });

      await expect(
        registered.service.startPasswordSignUp({
          email: "sam@acme.com",
          password: "not the password",
        }),
      ).resolves.toEqual({ outcome: "account_exists" });
      expect(registered.sent).toHaveLength(0);
      expect(registered.created).toHaveLength(0);
    });
  });
});
