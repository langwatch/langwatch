import type { RoutingDecision } from "@langwatch/identity-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import type { UserApi, UserProfile } from "@langwatch/user-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { MemorySignUpVerificationMailChannel } from "../../channels/memory/memory.sign-up-verification-mail.channel.ts";
import { SignUpVerificationMailChannel } from "../../channels/sign-up-verification-mail.channel.ts";
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
  emailUnconfigured = false,
  signUpRefused = false,
  mailer,
}: {
  holder?: UserProfile | null;
  decision?: RoutingDecision;
  budgetAllowed?: boolean;
  emailUnconfigured?: boolean;
  signUpRefused?: boolean;
  mailer?: SignUpVerificationMailChannel;
} = {}) {
  const memory = MemoryAuthDatabase.create();
  const mail = MemorySignUpVerificationMailChannel.create();
  const budgets: string[] = [];
  let clock = NOW;
  let minted = 0;
  let current = holder;
  let unconfigured = emailUnconfigured;

  const service = SignUpVerificationService.create({
    tokens: MemorySignUpVerificationTokenRepository.create({ memory }),
    mailer: mailer ?? mail,
    users: createApiFixture<UserApi>({ findByEmail: async () => current }),
    route: async () => decision,
    checkSignUp: async () =>
      signUpRefused ? { allowed: false, reason: "invite_only" } : { allowed: true, via: "open" },
    isWithinBudget: async ({ key }) => {
      budgets.push(key);
      return budgetAllowed ? { allowed: true } : { allowed: false, retryAfterSeconds: 60 };
    },
    buildVerificationUrl: ({ token }) => `https://app.test/auth/signup?verify=${token}`,
    isEmailUnconfigured: async () => unconfigured,
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
    configureEmail: () => {
      unconfigured = false;
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

  describe("when a confirmation link is requested", () => {
    /** @scenario Asking for verification creates no account */
    it("creates no account and no credential, even when the mailer is down", async () => {
      class DownMailer extends SignUpVerificationMailChannel {
        async sendVerificationLink(): Promise<void> {
          throw new Error("mailer down");
        }
      }
      const sent = makeService();
      const down = makeService({ mailer: new DownMailer() });

      await sent.service.requestVerification({ email: "sam@acme.com" });
      await expect(down.service.requestVerification({ email: "sam@acme.com" })).rejects.toThrow(
        "mailer down",
      );

      expect(sent.memory.sessions.size).toBe(0);
      expect(down.memory.sessions.size).toBe(0);
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
        freshClaim: true,
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
        freshClaim: false,
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

  describe("when two requests open the same unspent link at the same time", () => {
    /** @scenario Simultaneous confirmation-link consumers yield one proof */
    it("hands exactly one of them the proof and the other status only", async () => {
      const harness = makeService();
      await harness.service.requestVerification({ email: "sam@acme.com" });

      const answers = await Promise.all([
        harness.service.completeVerification({ token: "token-1" }),
        harness.service.completeVerification({ token: "token-1" }),
      ]);

      expect(answers.filter((answer) => answer.freshClaim)).toHaveLength(1);
      expect(answers.filter((answer) => answer.addressProof !== null)).toHaveLength(1);
      expect(answers.every((answer) => !answer.accountCreated)).toBe(true);
      expect(harness.memory.sessions.size).toBe(0);
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
        freshClaim: true,
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
    /** @scenario Sign-up never reveals account existence on an SSO domain */
    it.each([
      ["a confirmed account", account({ emailVerified: true })],
      ["an unconfirmed account", account({ emailVerified: false })],
      ["no account", null],
    ])("refuses %s alike and mails nothing", async (_label, holder) => {
      const harness = makeService({ decision: DOMAIN_DECISION, holder });

      await expect(
        harness.service.requestNewAccountVerification({ email: "sam@acme.com" }),
      ).rejects.toMatchObject({ code: "auth_direct_registration_unavailable" });
      expect(harness.mail.sent).toEqual([]);
    });

    it("refuses by name and mails nothing", async () => {
      const harness = makeService({ decision: DOMAIN_DECISION });

      await expect(
        harness.service.requestNewAccountVerification({ email: "sam@acme.com" }),
      ).rejects.toMatchObject({ code: "auth_direct_registration_unavailable" });
      expect(harness.mail.sent).toEqual([]);
    });
  });

  describe("when the address already holds a confirmed account", () => {
    /** @scenario Sign-up still guides an existing account outside SSO domains */
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

  describe("when the installation's sign-up policy refuses the address", () => {
    /** @scenario "A refused sign-up is told before a confirmation link is sent" */
    it("refuses a new address by code and mails nothing", async () => {
      const harness = makeService({ signUpRefused: true });

      await expect(
        harness.service.requestNewAccountVerification({ email: "stranger@example.com" }),
      ).rejects.toMatchObject({ code: "auth_sign_up_restricted" });
      expect(harness.mail.sent).toEqual([]);
      expect(harness.budgets).toEqual([]);
    });

    it("still mails the link again to an account awaiting confirmation", async () => {
      const harness = makeService({
        signUpRefused: true,
        holder: account({ emailVerified: false }),
      });

      await harness.service.requestNewAccountVerification({ email: "sam@acme.com" });

      expect(harness.mail.sent).toHaveLength(1);
    });
  });

  describe("when the address has spent its hourly budget", () => {
    /** @scenario "A stranger's address cannot be mail-bombed through sign-up" */
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

describe("given an installation that cannot send email", () => {
  describe("when a signed-out sign-up asks for a new account's link", () => {
    /** @scenario "An installation that cannot send email signs up with a password and leaves the address unconfirmed" */
    it("mails nothing and answers an unconfirmed proof for the normalized address", async () => {
      const harness = makeService({ emailUnconfigured: true });

      const answer = await harness.service.requestNewAccountVerification({
        email: " Sam@Acme.com ",
      });

      expect(answer).toEqual({ sent: false, addressProof: "token-1" });
      expect(harness.mail.sent).toEqual([]);
      expect(harness.memory.verificationTokens.get("token-1")?.expires).toEqual(
        NOW.add({ milliseconds: CONFIRMED_ADDRESS_TTL_MS }),
      );
      await expect(
        harness.service.claimUnconfirmedAddressProof({ token: "token-1", email: "sam@acme.com" }),
      ).resolves.toBe(true);
    });

    it("refuses an address that already holds an unconfirmed account, since nothing can confirm it", async () => {
      const harness = makeService({
        emailUnconfigured: true,
        holder: account({ emailVerified: false }),
      });

      await expect(
        harness.service.requestNewAccountVerification({ email: "sam@acme.com" }),
      ).rejects.toMatchObject({ code: "email_already_registered" });
    });
  });

  describe("when an unconfirmed proof is issued", () => {
    it("is single-use and bound to the address", async () => {
      const harness = makeService({ emailUnconfigured: true });
      const proof = await harness.service.issueUnconfirmedAddressProof({ email: "sam@acme.com" });

      await expect(
        harness.service.validateUnconfirmedAddressProof({ token: proof, email: "sam@acme.com" }),
      ).resolves.toBe(true);
      await expect(
        harness.service.claimUnconfirmedAddressProof({ token: proof, email: "other@acme.com" }),
      ).resolves.toBe(false);
      await expect(
        harness.service.claimUnconfirmedAddressProof({ token: proof, email: "sam@acme.com" }),
      ).resolves.toBe(true);
      await expect(
        harness.service.claimUnconfirmedAddressProof({ token: proof, email: "sam@acme.com" }),
      ).resolves.toBe(false);
    });

    it("stops working once its lifetime has passed", async () => {
      const harness = makeService({ emailUnconfigured: true });
      const proof = await harness.service.issueUnconfirmedAddressProof({ email: "sam@acme.com" });

      harness.advance(CONFIRMED_ADDRESS_TTL_MS + 1);

      await expect(
        harness.service.claimUnconfirmedAddressProof({ token: proof, email: "sam@acme.com" }),
      ).resolves.toBe(false);
    });
  });

  describe("when an unconfirmed proof is offered as a confirmed one", () => {
    /** @scenario "A confirmed address proof and an unconfirmed one never stand in for each other" */
    it("is refused by both confirmed-proof checks and stays unspent", async () => {
      const harness = makeService({ emailUnconfigured: true });
      const proof = await harness.service.issueUnconfirmedAddressProof({ email: "sam@acme.com" });

      await expect(
        harness.service.validateAddressProof({ token: proof, email: "sam@acme.com" }),
      ).resolves.toBe(false);
      await expect(
        harness.service.claimAddressProof({ token: proof, email: "sam@acme.com" }),
      ).resolves.toBe(false);
      await expect(
        harness.service.validateUnconfirmedAddressProof({ token: proof, email: "sam@acme.com" }),
      ).resolves.toBe(true);
    });
  });

  describe("when a confirmed proof is offered as an unconfirmed one", () => {
    /** @scenario "A confirmed address proof and an unconfirmed one never stand in for each other" */
    it("is refused by both unconfirmed-proof checks", async () => {
      const harness = makeService({ emailUnconfigured: true });
      await harness.service.requestVerification({ email: "sam@acme.com" });
      const { addressProof } = await harness.service.completeVerification({ token: "token-1" });
      if (!addressProof) throw new Error("the link minted no proof");

      await expect(
        harness.service.validateUnconfirmedAddressProof({
          token: addressProof,
          email: "sam@acme.com",
        }),
      ).resolves.toBe(false);
      await expect(
        harness.service.claimUnconfirmedAddressProof({
          token: addressProof,
          email: "sam@acme.com",
        }),
      ).resolves.toBe(false);
    });
  });

  describe("when the installation can send email again", () => {
    /** @scenario "An unconfirmed address proof is refused once the installation can send email" */
    it("refuses an unconfirmed proof without spending it", async () => {
      const harness = makeService({ emailUnconfigured: true });
      const proof = await harness.service.issueUnconfirmedAddressProof({ email: "sam@acme.com" });

      harness.configureEmail();

      await expect(
        harness.service.validateUnconfirmedAddressProof({ token: proof, email: "sam@acme.com" }),
      ).resolves.toBe(false);
      await expect(
        harness.service.claimUnconfirmedAddressProof({ token: proof, email: "sam@acme.com" }),
      ).resolves.toBe(false);
      expect(harness.memory.verificationTokens.has(proof)).toBe(true);
    });
  });
});
