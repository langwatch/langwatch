import type { IdentifierFact, IdentityHeads } from "@langwatch/identity";
import { reduceIdentity } from "@langwatch/identity";
import type {
  IdentityHeadsRepository,
  VerificationCeremonyService,
} from "@langwatch/identity-server";
import { IdentityGuards, IdentityService } from "@langwatch/identity-server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountIdentifiersService } from "../account-identifiers.service";

/**
 * Adding an address to an account, and what the surface is allowed to say
 * about it.
 *
 * The guard and the reducer are the real ones; only the heads are in memory,
 * so an assertion about what was appended is an assertion about what the
 * pipeline would have carried.
 *
 * Spec: specs/identity/authentication-settings.feature
 */

const USER_ID = "user_sam";

function head(
  overrides: Partial<IdentifierFact> & { identifierId: string },
): IdentifierFact {
  return {
    userId: USER_ID,
    provider: "email",
    value: "sam@acme.test",
    domain: "acme.test",
    identifierHash: null,
    accountId: null,
    providerAccountId: null,
    connectionId: null,
    state: "VERIFIED",
    verifiedAtMs: 1,
    attachedAtMs: 1,
    detachedAtMs: null,
    ...overrides,
  } as IdentifierFact;
}

function build({
  heads = { userId: USER_ID, identifiers: {} } as IdentityHeads,
  holder = null,
}: {
  heads?: IdentityHeads;
  holder?: { userId: string; identifierId: string } | null;
} = {}) {
  const state = { heads };
  const sent: { email: string; verificationUrl: string }[] = [];
  const appended: { type: string }[] = [];

  const repository: IdentityHeadsRepository = {
    findHeads: () => Promise.resolve(state.heads),
    findUserHashKey: () => Promise.resolve(null),
    findActiveIdentifierByValue: () => Promise.resolve(holder),
    findIdentifier: ({ identifierId }) =>
      Promise.resolve(state.heads.identifiers[identifierId] ?? null),
    findIdentifierIdForAccount: () => Promise.resolve(null),
  };

  const identity = new IdentityService(new IdentityGuards(repository), {
    commit: ({ facts }: { facts: { type: string }[] }) => {
      const stamped = facts.map((fact) => ({ ...fact, occurredAt: 1 }));
      appended.push(...stamped);
      for (const fact of stamped) {
        state.heads = reduceIdentity({
          heads: state.heads,
          fact: fact as never,
        });
      }
      return Promise.resolve(stamped);
    },
  } as never);

  const ceremony = {
    mintEmailVerification: vi.fn().mockResolvedValue({
      verificationId: "verif_1",
      token: "tok_1",
      expiresAtMs: 2,
    }),
  } as unknown as VerificationCeremonyService;

  const service = new AccountIdentifiersService(
    repository,
    identity,
    ceremony,
    {
      sendConfirmation: (args) => {
        sent.push(args);
        return Promise.resolve();
      },
      buildConfirmationUrl: ({ token }) =>
        `https://example.test/c?token=${token}`,
      newCommandId: () => "cmd_1",
      now: () => 1,
    },
  );

  return { service, appended, sent, ceremony, state };
}

/**
 * The refused command's code. Nothing has crossed a boundary here, so the
 * error is the instance the guard threw and `code` is read straight off it.
 */
const codeOf = (run: Promise<unknown>): Promise<string | undefined> =>
  run.then(
    () => undefined,
    (error: unknown) => (error as { code?: string }).code,
  );

describe("adding an address to an account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given an address nobody holds", () => {
    describe("when it is added", () => {
      /** @scenario A newly added address is attached unverified, and only the ceremony verifies it */
      it("attaches it unverified and appends no verification", async () => {
        const { service, appended, state } = build();

        const { identifierId } = await service.addEmailIdentifier({
          userId: USER_ID,
          email: "sam@other.test",
          codeChallenge: "a".repeat(43),
        });

        expect(appended.map((fact) => fact.type)).toEqual([
          "lw.identity.identifier_attached",
        ]);
        // Nothing has been proved about it yet, so nothing can be signed in
        // with it and nothing can be recovered through it.
        expect(state.heads.identifiers[identifierId]?.state).toBe("ATTACHED");
      });

      /** @scenario A newly added address is attached unverified, and only the ceremony verifies it */
      it("sends the emailed half of the ceremony to the address itself", async () => {
        const { service, sent, ceremony } = build();

        await service.addEmailIdentifier({
          userId: USER_ID,
          email: "sam@other.test",
          codeChallenge: "a".repeat(43),
        });

        expect(ceremony.mintEmailVerification).toHaveBeenCalledWith(
          expect.objectContaining({ codeChallenge: "a".repeat(43) }),
        );
        expect(sent).toHaveLength(1);
        expect(sent[0]!.email).toBe("sam@other.test");
        expect(sent[0]!.verificationUrl).toContain("tok_1");
      });
    });
  });

  describe("given the address is already live on this account", () => {
    describe("when it is added again", () => {
      /** @scenario Adding an address already on the account changes nothing */
      it("creates no second identifier and says it is already there", async () => {
        const { service, appended } = build({
          heads: {
            userId: USER_ID,
            identifiers: { existing: head({ identifierId: "existing" }) },
          },
          holder: { userId: USER_ID, identifierId: "existing" },
        });

        const code = await codeOf(
          service.addEmailIdentifier({
            userId: USER_ID,
            email: "sam@acme.test",
            codeChallenge: "a".repeat(43),
          }),
        );

        expect(code).toBe("identity_identifier_already_held");
        expect(appended).toHaveLength(0);
      });
    });
  });

  describe("given another account already holds the address", () => {
    describe("when it is added", () => {
      /** @scenario An address another account holds is not refused at the door */
      it("says nothing about who holds it, and attaches it unverified", async () => {
        const built = build({
          holder: { userId: "user_someone_else", identifierId: "theirs" },
        });

        const code = await codeOf(
          built.service.addEmailIdentifier({
            userId: USER_ID,
            email: "sam@acme.test",
            codeChallenge: "a".repeat(43),
          }),
        );

        // No refusal at all. Refusing here would answer "does an account exist
        // for this address" to anybody holding one, and an unverified
        // identifier blocks nobody — so verification is where the uniqueness
        // guard belongs, and where it is not an oracle.
        expect(code).toBeUndefined();
        expect(built.appended.map((fact) => fact.type)).toEqual([
          "lw.identity.identifier_attached",
        ]);
      });
    });
  });

  describe("given a mix of confirmed, unconfirmed and passkey identifiers", () => {
    describe("when the list is read", () => {
      /** @scenario Each email address says whether it has been confirmed */
      it("says of each what it is, and what the guard would say about losing it", async () => {
        const { service } = build({
          heads: {
            userId: USER_ID,
            identifiers: {
              confirmed: head({ identifierId: "confirmed", state: "PRIMARY" }),
              pending: head({
                identifierId: "pending",
                value: "sam@other.test",
                state: "ATTACHED",
                verifiedAtMs: null,
                attachedAtMs: 2,
              }),
              key: head({
                identifierId: "key",
                provider: "passkey",
                value: null,
                attachedAtMs: 3,
              }),
            },
          },
        });

        const list = await service.listIdentifiers({ userId: USER_ID });
        const byId = Object.fromEntries(
          list.map((row) => [row.identifierId, row]),
        );

        expect(byId.confirmed?.confirmed).toBe(true);
        expect(byId.confirmed?.isPrimary).toBe(true);
        expect(byId.confirmed?.demotesFirst).toBe(true);
        // Losing the only address would leave a passkey and nowhere to write.
        expect(byId.confirmed?.removable).toBe(false);
        expect(byId.confirmed?.refusalCode).toBe(
          "identity_detach_strands_user",
        );

        expect(byId.pending?.confirmed).toBe(false);
        expect(byId.pending?.resendable).toBe(true);
        // It strands nobody, because nobody could have signed in with it.
        expect(byId.pending?.removable).toBe(true);

        // A passkey is never a thing to resend a link to.
        expect(byId.key?.resendable).toBe(false);
      });
    });
  });
});
