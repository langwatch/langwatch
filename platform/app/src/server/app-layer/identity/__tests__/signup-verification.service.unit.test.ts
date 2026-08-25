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

function makeService({
  registered = false,
  addressIsConfirmed = false,
}: {
  registered?: boolean;
  addressIsConfirmed?: boolean;
} = {}) {
  const issued: Array<{ identifier: string; token: string; expires: Date }> =
    [];
  const sent: Array<{ email: string; verificationUrl: string }> = [];
  const created: Array<{ email: string; passwordHash: string }> = [];
  /** Addresses a spent link proved. The whole job of a link now. */
  const confirmed: string[] = [];
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
    directory: {
      stateFor: async () => {
        if (!addressIsTaken) return "unknown";
        return addressIsConfirmed ? "confirmed" : "awaiting_confirmation";
      },
    },
    accounts: {
      createCredentialAccount: async (account) => {
        created.push(account);
        addressIsTaken = true;
      },
      markAddressConfirmed: async ({ email }) => {
        confirmed.push(email);
      },
    },
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
    confirmed,
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
      ).resolves.toEqual({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: false,
        // Nothing here to mark as confirmed, so the proof carries the
        // confirmation to whichever call creates the account next.
        addressProof: expect.any(String),
      });

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

  describe("when a link is asked for", () => {
    it("carries the address alone, with no credential on it", async () => {
      await harness.service.requestVerification({ email: "sam@acme.com" });

      expect(harness.sent).toHaveLength(1);
      expect(harness.created).toHaveLength(0);
      // Nothing that could become a password travels on the link. Both doors
      // send this one, and the password is chosen once, on the screen the
      // link lands on, where it is typed twice and held to a length.
      expect(harness.issued[0]?.identifier).toContain('"passwordHash":null');
    });

    it("leaves the account to be finished, never creating one itself", async () => {
      await harness.service.requestVerification({ email: "sam@acme.com" });

      await expect(
        harness.service.completeVerification({ token: "token-1" }),
      ).resolves.toEqual({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: false,
        // Nothing here to mark as confirmed, so the proof carries the
        // confirmation to whichever call creates the account next.
        addressProof: expect.any(String),
      });
      expect(harness.created).toHaveLength(0);
    });
  });

  describe("when a link minted before the doors converged comes back", () => {
    /**
     * Nothing writes a credential onto a link any more, but links that were
     * issued with one are still in inboxes with an hour to live, and each was
     * promised an account. Seeded directly, because the method that used to
     * write them is gone.
     */
    function seedLinkCarryingCredential(harnessed: typeof harness) {
      harnessed.issued.push({
        identifier: `identity-signup-verification:${JSON.stringify({
          email: "sam@acme.com",
          passwordHash: FAKE_PASSWORD_HASH,
        })}`,
        token: "link-in-flight",
        expires: new Date(NOW.getTime() + SIGN_UP_VERIFICATION_TTL_MS),
      });
    }

    it("still creates the account it promised", async () => {
      seedLinkCarryingCredential(harness);

      await expect(
        harness.service.completeVerification({ token: "link-in-flight" }),
      ).resolves.toEqual({
        email: "sam@acme.com",
        accountCreated: true,
        accountExists: true,
        addressProof: null,
      });
      expect(harness.created).toEqual([
        { email: "sam@acme.com", passwordHash: FAKE_PASSWORD_HASH },
      ]);
      // Created AND proven: the link that made the account confirmed the
      // address in the same breath.
      expect(harness.confirmed).toEqual(["sam@acme.com"]);
    });

    it("creates nothing when the address gained an account meanwhile", async () => {
      seedLinkCarryingCredential(harness);
      harness.takeAddress();

      // The link confirms an ADDRESS; it does not entitle it to overwrite
      // whatever now answers for it. So the account stands and the address is
      // still proven — which is the whole of what a link is for now.
      await expect(
        harness.service.completeVerification({ token: "link-in-flight" }),
      ).resolves.toEqual({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: true,
        addressProof: null,
      });
      expect(harness.confirmed).toEqual(["sam@acme.com"]);
      expect(harness.created).toHaveLength(0);
    });
  });
});
