import { createApiFixture } from "@langwatch/api-fixture";
import type { RoutingDecision } from "@langwatch/identity-contract";
import { Temporal } from "@langwatch/time";
import type { UserApi, UserProfile } from "@langwatch/user-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { MemorySignUpVerificationMailChannel } from "../../channels/memory/memory.sign-up-verification-mail.channel.ts";
import { MemoryAuthDatabase } from "../../repositories/memory/memory.auth.database.ts";
import { MemorySignUpVerificationTokenRepository } from "../../repositories/memory/memory.signup-verification-token.repository.ts";
import {
  CONFIRMED_ADDRESS_TTL_MS,
  SIGN_UP_VERIFICATION_TTL_MS,
  SPENT_LINK_GRACE_MS,
  SignUpVerificationService,
} from "../signup-verification.service.ts";

/** Sign-up's address confirmation (D13, ADR-117 §6), over the memory token rows and mail twin. */
const NOW = Temporal.Instant.from("2026-08-24T12:00:00.000Z");

const SIGN_UP_DECISION: RoutingDecision = {
  outcome: "route_to_signup",
  methodSet: [],
  reasonCode: "identifier_unknown",
};

const DOMAIN_DECISION: RoutingDecision = {
  outcome: "redirect_to_connection",
  connectionId: "conn_acme",
  methodSet: [{ id: "conn_acme", kind: "federated", connectionId: "conn_acme" }],
  reasonCode: "domain_routed",
};

function account({ emailVerified }: { emailVerified: boolean }): UserProfile {
  return {
    id: "user_sam",
    name: "Sam",
    email: "sam@acme.com",
    emailVerified,
    image: null,
    pendingSsoSetup: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastLoginAt: null,
    deactivatedAt: null,
  };
}

function makeService({
  holder = null,
  decision = SIGN_UP_DECISION,
  budgetAllowed = true,
}: {
  holder?: UserProfile | null;
  decision?: RoutingDecision;
  budgetAllowed?: boolean;
} = {}) {
  const memory = MemoryAuthDatabase.create();
  const mail = MemorySignUpVerificationMailChannel.create();
  const budgets: string[] = [];
  let clock = NOW;
  let minted = 0;
  let current = holder;

  const service = SignUpVerificationService.create({
    tokens: MemorySignUpVerificationTokenRepository.create({ memory }),
    mailer: mail,
    users: createApiFixture<UserApi>({ findByEmail: async () => current }),
    route: async () => decision,
    isWithinBudget: async ({ key }) => {
      budgets.push(key);
      return budgetAllowed ? { allowed: true } : { allowed: false, retryAfterSeconds: 60 };
    },
    buildVerificationUrl: ({ token }) => `https://app.test/auth/signup?verify=${token}`,
    now: () => clock,
    mintToken: () => `token-${++minted}`,
  });

  return {
    service,
    memory,
    mail,
    budgets,
    advance: (milliseconds: number) => {
      clock = clock.add({ milliseconds });
    },
    hold: (profile: UserProfile) => {
      current = profile;
    },
  };
}

describe("given a sign-up address to confirm", () => {
  describe("when the address is submitted", () => {
    it("emails a normalized link that expires in an hour", async () => {
      const harness = makeService();

      await harness.service.requestVerification({ email: " Sam@Acme.com " });

      expect(harness.mail.sent).toEqual([
        { email: "sam@acme.com", verificationUrl: "https://app.test/auth/signup?verify=token-1" },
      ]);
      expect(harness.memory.verificationTokens.get("token-1")?.expires).toEqual(
        NOW.add({ milliseconds: SIGN_UP_VERIFICATION_TTL_MS }),
      );
    });
  });

  describe("when the emailed link comes back for an address with no account", () => {
    it("answers the address with a proof that lives for the credential step", async () => {
      const harness = makeService();
      await harness.service.requestVerification({ email: "sam@acme.com" });

      await expect(harness.service.completeVerification({ token: "token-1" })).resolves.toEqual({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: false,
        addressProof: "token-2",
      });
      expect(harness.memory.verificationTokens.get("token-2")?.expires).toEqual(
        NOW.add({ milliseconds: CONFIRMED_ADDRESS_TTL_MS }),
      );
    });
  });

  describe("when the same link is opened a second time", () => {
    let harness: ReturnType<typeof makeService>;

    beforeEach(async () => {
      harness = makeService();
      await harness.service.requestVerification({ email: "sam@acme.com" });
      await harness.service.completeVerification({ token: "token-1" });
    });

    /** @scenario "Opening a confirmation link a second time confirms, rather than refusing" */
    it("answers as the first opening did, without a fresh proof", async () => {
      await expect(harness.service.completeVerification({ token: "token-1" })).resolves.toEqual({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: false,
        addressProof: null,
      });
    });

    /** @scenario "A spent link stops working once its grace window closes" */
    it("refuses once the spent link's grace has run out", async () => {
      harness.advance(SPENT_LINK_GRACE_MS + 1);

      await expect(
        harness.service.completeVerification({ token: "token-1" }),
      ).rejects.toMatchObject({ code: "identity_verification_expired" });
    });
  });

  describe("when the address gained an account before the link came back", () => {
    /** @scenario "A confirmation link never opens an account it did not create" */
    it("refuses rather than adopting the account", async () => {
      const harness = makeService();
      await harness.service.requestVerification({ email: "sam@acme.com" });
      harness.hold(account({ emailVerified: false }));

      await expect(
        harness.service.completeVerification({ token: "token-1" }),
      ).rejects.toMatchObject({ code: "identity_verification_expired" });
    });
  });

  describe("when the link never existed or belongs to another feature", () => {
    /** @scenario "A link nobody ever issued is refused the way an expired one is" */
    it("refuses both the same way", async () => {
      const harness = makeService();
      harness.memory.verificationTokens.set("borrowed", {
        identifier: "password-reset:sam@acme.com",
        token: "borrowed",
        expires: NOW.add({ hours: 1 }),
      });

      await expect(
        harness.service.completeVerification({ token: "never-issued" }),
      ).rejects.toMatchObject({ code: "identity_verification_expired" });
      await expect(
        harness.service.completeVerification({ token: "borrowed" }),
      ).rejects.toMatchObject({ code: "identity_verification_expired" });
    });
  });

  describe("when a link minted before the doors converged carries a credential", () => {
    it("treats the credential as untrusted and hands back the proof instead", async () => {
      const harness = makeService();
      harness.memory.verificationTokens.set("in-flight", {
        identifier: `identity-signup-verification:${JSON.stringify({
          email: "sam@acme.com",
          passwordHash: "$2b$10$notthepassword",
        })}`,
        token: "in-flight",
        expires: NOW.add({ milliseconds: SIGN_UP_VERIFICATION_TTL_MS }),
      });

      await expect(harness.service.completeVerification({ token: "in-flight" })).resolves.toEqual({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: false,
        addressProof: "token-1",
      });
    });
  });
});

describe("given what an address already is", () => {
  it("answers unknown, awaiting confirmation and confirmed", async () => {
    await expect(makeService().service.addressState({ email: "sam@acme.com" })).resolves.toBe(
      "unknown",
    );
    await expect(
      makeService({ holder: account({ emailVerified: false }) }).service.addressState({
        email: "sam@acme.com",
      }),
    ).resolves.toBe("awaiting_confirmation");
    await expect(
      makeService({ holder: account({ emailVerified: true }) }).service.addressState({
        email: "sam@acme.com",
      }),
    ).resolves.toBe("confirmed");
  });
});

describe("given the proof a spent link handed to the credential step", () => {
  async function proven() {
    const harness = makeService();
    await harness.service.requestVerification({ email: "sam@acme.com" });
    await harness.service.completeVerification({ token: "token-1" });
    return harness;
  }

  it("is spent exactly once, and only for the address it proved", async () => {
    const harness = await proven();

    await expect(
      harness.service.claimAddressProof({ token: "token-2", email: "eve@acme.com" }),
    ).resolves.toBe(false);
    await expect(
      harness.service.claimAddressProof({ token: "token-2", email: " Sam@Acme.com " }),
    ).resolves.toBe(true);
    await expect(
      harness.service.claimAddressProof({ token: "token-2", email: "sam@acme.com" }),
    ).resolves.toBe(false);
  });

  it("is checked by a ceremony without being spent", async () => {
    const harness = await proven();

    await expect(
      harness.service.validateAddressProof({ token: "token-2", email: "sam@acme.com" }),
    ).resolves.toBe(true);
    await expect(
      harness.service.claimAddressProof({ token: "token-2", email: "sam@acme.com" }),
    ).resolves.toBe(true);
  });
});

describe("given a signed-out sign-up asking for a new account's link", () => {
  describe("when the address's organization signs in through its own connection", () => {
    it("refuses by name and mails nothing", async () => {
      const harness = makeService({ decision: DOMAIN_DECISION });

      await expect(
        harness.service.requestNewAccountVerification({ email: "sam@acme.com" }),
      ).rejects.toMatchObject({ code: "auth_direct_registration_unavailable" });
      expect(harness.mail.sent).toEqual([]);
    });
  });

  describe("when the address already holds a confirmed account", () => {
    it("refuses by name and mails nothing", async () => {
      const harness = makeService({ holder: account({ emailVerified: true }) });

      await expect(
        harness.service.requestNewAccountVerification({ email: "sam@acme.com" }),
      ).rejects.toMatchObject({ code: "email_already_registered" });
      expect(harness.mail.sent).toEqual([]);
    });
  });

  describe("when the address holds an account still awaiting confirmation", () => {
    it("mails the link again", async () => {
      const harness = makeService({ holder: account({ emailVerified: false }) });

      await harness.service.requestNewAccountVerification({ email: "sam@acme.com" });

      expect(harness.mail.sent).toHaveLength(1);
    });
  });

  describe("when the address has spent its hourly budget", () => {
    it("refuses with the wait, keyed on the address", async () => {
      const harness = makeService({ budgetAllowed: false });

      await expect(
        harness.service.requestNewAccountVerification({ email: "Sam@Acme.com" }),
      ).rejects.toMatchObject({ code: "auth_rate_limited", meta: { retryAfterSeconds: 60 } });
      expect(harness.budgets).toEqual(["auth.requestSignUpVerification:address:sam@acme.com"]);
      expect(harness.mail.sent).toEqual([]);
    });
  });
});
