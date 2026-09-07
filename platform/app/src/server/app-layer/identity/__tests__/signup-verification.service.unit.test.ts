import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SIGN_UP_VERIFICATION_TTL_MS,
  SignUpVerificationService,
  SPENT_LINK_GRACE_MS,
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
  let clock = NOW;
  /**
   * Rows a claim left behind, the way the real store leaves them: a spent
   * token is not gone, it is marked — which is what lets somebody opening
   * their own link twice be told the truth rather than "expired".
   */
  const spentMarkers = new Map<string, { identifier: string; expires: Date }>();
  let mints = 0;

  const service = new SignUpVerificationService({
    tokens: {
      issue: async (record) => {
        issued.push(record);
      },
      claim: async ({ token, now, keepSpentUntil }) => {
        const index = issued.findIndex((record) => record.token === token);
        if (index === -1) return null;
        const [record] = issued.splice(index, 1);
        if (!record || record.expires <= now) return null;
        if (keepSpentUntil) {
          spentMarkers.set(token, {
            identifier: record.identifier,
            expires: keepSpentUntil,
          });
        }
        return { identifier: record.identifier };
      },
      findSpent: async ({ token, now }) => {
        const marker = spentMarkers.get(token);
        if (!marker || marker.expires <= now) return null;
        return { identifier: marker.identifier };
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
    now: () => clock,
    mintToken: vi.fn(() => {
      mints += 1;
      return `token-${mints}`;
    }),
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
    confirmAddress: () => {
      addressIsConfirmed = true;
    },
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
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
    it("confirms the address, and says so again if asked again", async () => {
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

      // The TOKEN is spent — the identifier it stood for can never be claimed
      // twice — but the ANSWER it earned survives its grace window, because a
      // link in an inbox gets opened more than once and the second opening is
      // the same person asking the same question.
      await expect(
        harness.service.completeVerification({ token: "token-1" }),
      ).resolves.toMatchObject({ email: "sam@acme.com" });
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

/**
 * A LINK OPENED TWICE. The single most common way this screen used to lie:
 * spending a token removed its row, so a second opening could not be told
 * apart from a token nobody ever issued, and both were called expired — to
 * somebody holding a link that had just arrived and had just worked.
 */
describe("given a confirmation link I have already opened", () => {
  let harness: ReturnType<typeof makeService>;

  beforeEach(async () => {
    harness = makeService();
    await harness.service.requestVerification({ email: "sam@acme.com" });
    // Sign-up made the account; the link is the address catching up with it.
    harness.takeAddress();
    await harness.service.completeVerification({ token: "token-1" });
    harness.confirmAddress();
  });

  describe("when I open the same link again", () => {
    /** @scenario "Opening a confirmation link a second time confirms, rather than refusing" */
    it("carries on as though it had just worked", async () => {
      await expect(
        harness.service.completeVerification({ token: "token-1" }),
      ).resolves.toEqual({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: true,
        addressProof: null,
      });
    });

    /** @scenario "Opening a confirmation link a second time confirms, rather than refusing" */
    it("creates nothing a second time", async () => {
      const confirmationsBefore = harness.confirmed.length;

      await harness.service.completeVerification({ token: "token-1" });

      expect(harness.created).toHaveLength(0);
      // The address was proven by the first opening. Proving it again is not
      // harmless bookkeeping, it is a write nobody asked for.
      expect(harness.confirmed).toHaveLength(confirmationsBefore);
    });
  });

  describe("when the grace window has closed", () => {
    /** @scenario "A spent link stops working once its grace window closes" */
    it("says the link expired", async () => {
      harness.advance(SPENT_LINK_GRACE_MS + 1);

      await expect(
        harness.service.completeVerification({ token: "token-1" }),
      ).rejects.toMatchObject({ code: "identity_verification_expired" });
    });
  });
});

describe("given a confirmation link nobody ever issued", () => {
  describe("when I open it", () => {
    /** @scenario "A link nobody ever issued is refused the way an expired one is" */
    it("is refused the way an expired one is, saying nothing more", async () => {
      const harness = makeService();

      await expect(
        harness.service.completeVerification({ token: "never-minted" }),
      ).rejects.toMatchObject({ code: "identity_verification_expired" });
    });
  });
});

/**
 * The other half of a reopening: the link proved an address with no account
 * behind it, and the password was never chosen. A second opening has to hand
 * the screen a usable proof, or somebody is stranded one step from the end.
 */
describe("given a link that proved an address with no account yet", () => {
  describe("when I open it a second time", () => {
    it("hands over a fresh proof rather than the spent one", async () => {
      const harness = makeService();
      await harness.service.requestVerification({ email: "sam@acme.com" });

      const first = await harness.service.completeVerification({
        token: "token-1",
      });
      const again = await harness.service.completeVerification({
        token: "token-1",
      });

      expect(first.addressProof).not.toBeNull();
      expect(again).toMatchObject({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: false,
      });
      // A FRESH proof, never the spent one: proofs are single-use on their
      // own account, so handing the same one back is handing back nothing.
      expect(again.addressProof).not.toBeNull();
      expect(again.addressProof).not.toBe(first.addressProof);
    });
  });
});
