import type { AuthApi, BrowserSessionInventoryEntry } from "@langwatch/auth-contract";
import type {
  IdentityCommand,
  IdentityFactInput,
  IdentityHeads,
} from "@langwatch/identity-contract";
import { memoryRateLimiter } from "@langwatch/test-harness";
/**
 * @vitest-environment node
 * The account's own sign-in addresses over the real guard and reducer; the heads are in memory.
 * @see specs/identity/authentication-settings.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { fact, InMemoryHeads, T0, USER } from "../../__tests__/support/in-memory-heads.ts";
import { InMemoryReservations } from "../../__tests__/support/in-memory-reservations.ts";
import { InMemoryUsers } from "../../__tests__/support/in-memory-users.ts";
import { MemoryAddressConfirmationMailChannel } from "../../channels/memory/memory.address-confirmation-mail.channel.ts";
import type { IdentityLedger } from "../../rules/identity-ledger.rules.ts";
import { AccountIdentifiersService } from "../account-identifiers.service.ts";
import { CryptoIdentifierIdentityService } from "../crypto-identifier-identity.service.ts";
import { IdentityGuardsService } from "../identity-guards.service.ts";
import { IdentityService } from "../identity.service.ts";
import type { VerificationCeremonyService } from "../verification-ceremony.service.ts";

const CHALLENGE = "a".repeat(43);

/** Commits by folding into the in-memory heads, as the projection would. */
class FoldingLedger implements IdentityLedger {
  readonly appended: string[] = [];

  constructor(private readonly heads: InMemoryHeads) {}

  async commit({ command, facts }: { command: IdentityCommand; facts: IdentityFactInput[] }) {
    this.appended.push(...facts.map((stated) => stated.type));
    this.heads.fold(command.data.userId, facts, command.data.occurredAtMs);
    return facts.map((stated) => ({ ...stated, occurredAt: command.data.occurredAtMs }));
  }
}

function harness({
  heads: initial,
  sessions = [],
  allowance,
  accountAddress = null,
  mailDelivery = true,
}: {
  heads?: IdentityHeads;
  sessions?: BrowserSessionInventoryEntry[];
  allowance?: number;
  /** The account's own address and whether `User.emailVerified` holds it. */
  accountAddress?: { email: string; confirmed: boolean } | null;
  mailDelivery?: boolean;
} = {}) {
  const heads = new InMemoryHeads();
  if (initial) heads.heads.set(USER, initial);
  const ledger = new FoldingLedger(heads);
  const mail = MemoryAddressConfirmationMailChannel.create();
  const mintEmailVerification = vi.fn<VerificationCeremonyService["mintEmailVerification"]>(
    async () => ({ verificationId: "verif_1", token: "tok_1", expiresAtMs: T0 + 1 }),
  );
  const service = AccountIdentifiersService.create({
    heads,
    identity: IdentityService.create(
      IdentityGuardsService.create({
        heads,
        users: new InMemoryUsers(),
        reservations: new InMemoryReservations(),
        identifiers: CryptoIdentifierIdentityService.create(),
      }),
      ledger,
    ),
    ceremony: createApiFixture<Pick<VerificationCeremonyService, "mintEmailVerification">>({
      mintEmailVerification,
    }),
    mail,
    rateLimiter: memoryRateLimiter(allowance),
    sessions: createApiFixture<Pick<AuthApi, "listBrowserSessions">>({
      listBrowserSessions: async () => sessions,
    }),
    accountAddress: async () => accountAddress,
    hasMailDelivery: async () => mailDelivery,
    now: () => T0 + 10,
  });
  return { service, heads, ledger, mail, mintEmailVerification };
}

function holding(...identifiers: ReturnType<typeof fact>[]): IdentityHeads {
  return {
    userId: USER,
    identifiers: Object.fromEntries(identifiers.map((head) => [head.identifierId, head])),
  };
}

function session(overrides: Partial<BrowserSessionInventoryEntry>): BrowserSessionInventoryEntry {
  return {
    sessionId: "sess",
    identifierId: null,
    method: "Password",
    secondFactorProven: false,
    ipAddress: null,
    userAgent: null,
    signedInAt: "2026-09-01T00:00:00.000Z",
    lastActiveAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2026-10-01T00:00:00.000Z",
    current: false,
    ...overrides,
  };
}

describe("AccountIdentifiersService", () => {
  describe("given an address nobody holds", () => {
    describe("when it is added", () => {
      /** @scenario "A newly added address is attached unverified, and only the ceremony verifies it" */
      it("attaches it unverified and appends no verification", async () => {
        const { service, heads, ledger } = harness();

        const { identifierId } = await service.addEmailIdentifier({
          userId: USER,
          email: "sam@other.test",
          codeChallenge: CHALLENGE,
        });

        expect(ledger.appended).toEqual(["lw.identity.identifier_attached"]);
        expect((await heads.findHeads({ userId: USER })).identifiers[identifierId]?.state).toBe(
          "ATTACHED",
        );
      });

      /** @scenario "A newly added address is attached unverified, and only the ceremony verifies it" */
      it("mails the emailed half of the ceremony to the address itself", async () => {
        const { service, mail, mintEmailVerification } = harness();

        const { identifierId } = await service.addEmailIdentifier({
          userId: USER,
          email: "sam@other.test",
          codeChallenge: CHALLENGE,
        });

        expect(mintEmailVerification).toHaveBeenCalledWith({
          userId: USER,
          identifierId,
          codeChallenge: CHALLENGE,
        });
        expect(mail.sent).toEqual([
          { email: "sam@other.test", identifierId, verificationId: "verif_1", token: "tok_1" },
        ]);
      });
    });
  });

  describe("given the address is already live on this account", () => {
    describe("when it is added again", () => {
      /** @scenario "Adding an address already on the account changes nothing" */
      it("creates no second identifier and says it is already there", async () => {
        const { service, ledger, mail } = harness({
          heads: holding(fact({ identifierId: "existing", value: "sam@acme.com" })),
        });

        await expect(
          service.addEmailIdentifier({
            userId: USER,
            email: "Sam@Acme.com",
            codeChallenge: CHALLENGE,
          }),
        ).rejects.toMatchObject({ code: "identity_identifier_already_held" });
        expect(ledger.appended).toEqual([]);
        expect(mail.sent).toEqual([]);
      });
    });
  });

  describe("given another account already holds the address", () => {
    describe("when it is added", () => {
      /** @scenario "An address another account holds is not refused at the door" */
      it("says nothing about who holds it, and attaches it unverified", async () => {
        const { service, heads, ledger } = harness();
        heads.activeByValue.set("sam@acme.com", { userId: "user_other", identifierId: "theirs" });

        await service.addEmailIdentifier({
          userId: USER,
          email: "sam@acme.com",
          codeChallenge: CHALLENGE,
        });

        expect(ledger.appended).toEqual(["lw.identity.identifier_attached"]);
      });
    });
  });

  describe("given the caller has used up the hour's confirmation mails", () => {
    it("refuses adding with the rate-limited code and mails nothing", async () => {
      const { service, mail } = harness({ allowance: 0 });

      await expect(
        service.addEmailIdentifier({
          userId: USER,
          email: "sam@other.test",
          codeChallenge: CHALLENGE,
        }),
      ).rejects.toMatchObject({ code: "auth_rate_limited" });
      expect(mail.sent).toEqual([]);
    });

    it("refuses resending with the rate-limited code", async () => {
      const { service } = harness({ allowance: 0 });

      await expect(
        service.resendConfirmation({
          userId: USER,
          identifierId: "pending",
          codeChallenge: CHALLENGE,
        }),
      ).rejects.toMatchObject({ code: "auth_rate_limited" });
    });
  });

  describe("given the account's own address is attached but never confirmed", () => {
    describe("when the owner asks for its confirmation", () => {
      /** @scenario "The own address confirmation only ever goes to the session's own address" */
      it("starts the ceremony for that identifier and names it back", async () => {
        const { service, mail, mintEmailVerification } = harness({
          heads: holding(fact({ identifierId: "idf_own", state: "ATTACHED", verifiedAtMs: null })),
        });

        await expect(
          service.sendOwnAddressConfirmation({
            userId: USER,
            email: "Sam@Acme.com",
            codeChallenge: CHALLENGE,
          }),
        ).resolves.toEqual({ identifierId: "idf_own" });
        expect(mintEmailVerification).toHaveBeenCalledWith({
          userId: USER,
          identifierId: "idf_own",
          codeChallenge: CHALLENGE,
        });
        expect(mail.sent).toEqual([
          {
            email: "sam@acme.com",
            identifierId: "idf_own",
            verificationId: "verif_1",
            token: "tok_1",
          },
        ]);
      });
    });
  });

  describe("given the account's own address is already confirmed", () => {
    /** @scenario "An own address that is already confirmed is not confirmed again" */
    it("sends nothing and says it is not awaiting confirmation", async () => {
      const { service, mail } = harness({ heads: holding(fact({ identifierId: "idf_own" })) });

      await expect(
        service.sendOwnAddressConfirmation({
          userId: USER,
          email: "sam@acme.com",
          codeChallenge: CHALLENGE,
        }),
      ).rejects.toMatchObject({ code: "identity_identifier_not_verifiable" });
      expect(mail.sent).toEqual([]);
    });
  });

  describe("given the account is not known by its own address", () => {
    /** @scenario "An own address the account is not known by sends nothing" */
    it("sends nothing and says the address was not found", async () => {
      const { service, mail } = harness({
        heads: holding(fact({ identifierId: "idf_other", value: "sam@other.test" })),
      });

      await expect(
        service.sendOwnAddressConfirmation({
          userId: USER,
          email: "sam@acme.com",
          codeChallenge: CHALLENGE,
        }),
      ).rejects.toMatchObject({ code: "identity_identifier_not_found" });
      expect(mail.sent).toEqual([]);
    });
  });

  describe("given a primary address, an unconfirmed one and a passkey", () => {
    describe("when the list is read", () => {
      it("says of each what it is, and what the guard would say about losing it", async () => {
        const { service } = harness({
          heads: holding(
            fact({ identifierId: "confirmed", state: "PRIMARY" }),
            fact({
              identifierId: "pending",
              value: "sam@other.test",
              state: "ATTACHED",
              verifiedAtMs: null,
              attachedAtMs: T0 + 1,
            }),
            fact({ identifierId: "key", provider: "passkey", value: null, attachedAtMs: T0 + 2 }),
          ),
        });

        const byId = Object.fromEntries(
          (await service.listIdentifiers({ userId: USER })).map((row) => [row.identifierId, row]),
        );

        expect(byId.confirmed).toMatchObject({
          confirmed: true,
          isPrimary: true,
          demotesFirst: true,
          removable: false,
          refusalCode: "identity_detach_strands_user",
        });
        expect(byId.pending).toMatchObject({ confirmed: false, resendable: true, removable: true });
        expect(byId.key).toMatchObject({ resendable: false });
      });
    });
  });

  describe("given the account's own address was confirmed on the account but never through its identifier", () => {
    const heads = holding(
      fact({ identifierId: "own", value: "sam@acme.com", state: "ATTACHED", verifiedAtMs: null }),
      fact({
        identifierId: "other",
        value: "sam@other.test",
        state: "ATTACHED",
        verifiedAtMs: null,
        attachedAtMs: T0 + 1,
      }),
    );

    describe("when the list is read with the account's own address confirmed", () => {
      /** @scenario "The account's own address confirmed outside the app shows as confirmed" */
      it("shows the own address as confirmed and offers no resend for it", async () => {
        const { service } = harness({
          heads,
          accountAddress: { email: "Sam@Acme.com", confirmed: true },
        });

        const byId = Object.fromEntries(
          (await service.listIdentifiers({ userId: USER })).map((row) => [row.identifierId, row]),
        );

        expect(byId.own).toMatchObject({ confirmed: true, resendable: false });
        // Only the account's own address follows the account's column.
        expect(byId.other).toMatchObject({ confirmed: false, resendable: true });
      });
    });

    describe("when the account's own address is not confirmed either", () => {
      /** @scenario "The account's own address confirmed outside the app shows as confirmed" */
      it("keeps it as not confirmed yet", async () => {
        const { service } = harness({
          heads,
          accountAddress: { email: "sam@acme.com", confirmed: false },
        });

        const list = await service.listIdentifiers({ userId: USER });

        expect(list.find((row) => row.identifierId === "own")?.confirmed).toBe(false);
      });
    });
  });

  describe("given an installation that cannot send email", () => {
    describe("when an address is added", () => {
      /** @scenario "Adding or resending an address without a way to send email is refused with a named error" */
      it("refuses with a named error and attaches nothing", async () => {
        const { service, heads, mail } = harness({ mailDelivery: false });

        await expect(
          service.addEmailIdentifier({
            userId: USER,
            email: "sam@other.test",
            codeChallenge: CHALLENGE,
          }),
        ).rejects.toMatchObject({ code: "auth_email_sending_unavailable" });
        expect(Object.keys((await heads.findHeads({ userId: USER })).identifiers)).toEqual([]);
        expect(mail.sent).toEqual([]);
      });
    });

    describe("when an address is sent its link again", () => {
      /** @scenario "Adding or resending an address without a way to send email is refused with a named error" */
      it("refuses with a named error and sends nothing", async () => {
        const { service, mail, mintEmailVerification } = harness({
          heads: holding(fact({ identifierId: "pending", state: "ATTACHED", verifiedAtMs: null })),
          mailDelivery: false,
        });

        await expect(
          service.resendConfirmation({
            userId: USER,
            identifierId: "pending",
            codeChallenge: CHALLENGE,
          }),
        ).rejects.toMatchObject({ code: "auth_email_sending_unavailable" });
        expect(mintEmailVerification).not.toHaveBeenCalled();
        expect(mail.sent).toEqual([]);
      });
    });
  });

  describe("given a primary address and another confirmed one", () => {
    describe("when the primary is removed", () => {
      it("promotes the other before detaching the primary", async () => {
        const { service, heads, ledger } = harness({
          heads: holding(
            fact({ identifierId: "primary", state: "PRIMARY" }),
            fact({ identifierId: "second", value: "sam@other.test" }),
          ),
        });

        await service.removeIdentifier({ userId: USER, identifierId: "primary" });

        const after = (await heads.findHeads({ userId: USER })).identifiers;
        expect(ledger.appended).toContain("lw.identity.identifier_detached");
        expect(after.second?.state).toBe("PRIMARY");
        expect(after.primary?.state).toBe("DETACHED");
      });
    });
  });

  describe("given an identifier that is not the caller's", () => {
    it("refuses the removal as not found", async () => {
      const { service } = harness();

      await expect(
        service.removeIdentifier({ userId: USER, identifierId: "nobody" }),
      ).rejects.toMatchObject({ code: "identity_identifier_not_found" });
    });
  });

  describe("given sessions minted by several methods", () => {
    it("answers each method's newest sign-in and the newest second-factor one", async () => {
      const { service } = harness({
        sessions: [
          session({ identifierId: "pw", signedInAt: "2026-09-01T00:00:00.000Z" }),
          session({
            identifierId: "pw",
            signedInAt: "2026-09-03T00:00:00.000Z",
            secondFactorProven: true,
          }),
          session({ identifierId: "key", signedInAt: "2026-09-02T00:00:00.000Z" }),
          session({ identifierId: null, signedInAt: "2026-09-04T00:00:00.000Z" }),
        ],
      });

      await expect(service.getMethodsLastUsed({ userId: USER })).resolves.toEqual({
        byIdentifier: { pw: "2026-09-03T00:00:00.000Z", key: "2026-09-02T00:00:00.000Z" },
        secondFactorAt: "2026-09-03T00:00:00.000Z",
      });
    });
  });
});
