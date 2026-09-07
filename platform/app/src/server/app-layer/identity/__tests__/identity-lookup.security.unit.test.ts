import {
  type AccountSignInMethods,
  type IdentityCommand,
  type IdentityFact,
  type IdentityFactInput,
  type IdentityHeads,
  reduceIdentity,
} from "@langwatch/identity";
import {
  IdentityGuards,
  type IdentityHeadsRepository,
  type IdentityLedger,
  type IdentityReservationRepository,
  IdentityService,
  type IdentityUsersRepository,
  LinkProposalGuards,
  type LinkProposalReadsRepository,
  type LinkProposalRecord,
  LinkProposalService,
  SignInRouterService,
} from "@langwatch/identity-server";
import { describe, expect, it, vi } from "vitest";
import { IdentityLookupService } from "../identity-lookup.service";
import type { IdentityHistoryReadsRepository } from "../repositories/identity-event-log.repository";
import type {
  IdentityLookupReadsRepository,
  LookupIdentifierRow,
} from "../repositories/identity-lookup.prisma.repository";

const USER_ID = "user_sam";
const OPERATOR_ID = "user_olive";
const NOW = 1_700_000_000_000;

function occurred(fact: IdentityFactInput, occurredAt: number): IdentityFact {
  return { ...fact, occurredAt };
}

class Heads implements IdentityHeadsRepository {
  constructor(
    private current: IdentityHeads,
    private readonly projected?: { current: IdentityHeads },
  ) {}

  async findUserHashKey(): Promise<string | null> {
    return null;
  }

  async findHeads(): Promise<IdentityHeads> {
    return this.current;
  }

  async hasFolded(): Promise<boolean> {
    return true;
  }

  async findActiveIdentifierByValue(): Promise<{
    userId: string;
    identifierId: string;
  } | null> {
    return null;
  }

  async findIdentifier(args: { userId: string; identifierId: string }) {
    return this.current.identifiers[args.identifierId] ?? null;
  }

  async findIdentifierIdForAccount(): Promise<string | null> {
    return null;
  }

  fold(facts: readonly IdentityFactInput[], occurredAt: number): void {
    this.current = facts.reduce(
      (heads, fact) =>
        reduceIdentity({
          heads,
          fact: occurred(fact, occurredAt),
        }),
      this.current,
    );
    if (this.projected) this.projected.current = this.current;
  }
}

class Users implements IdentityUsersRepository {
  async storeUserHashKeyIfMissing(): Promise<void> {}

  async findEmail(): Promise<string | null> {
    return null;
  }

  async findUserIdByEmail(): Promise<string | null> {
    return null;
  }
}

class Reservations implements IdentityReservationRepository {
  async claim(input: {
    normalizedValue: string;
    userId: string;
    identifierId: string;
    commandId: string;
  }) {
    return input;
  }

  async release(): Promise<number> {
    return 0;
  }

  async reapOrphans(): Promise<number> {
    return 0;
  }
}

function ledgerThatRecords(
  committed: IdentityCommandRecord[],
  afterCommit?: (
    facts: readonly IdentityFactInput[],
    occurredAt: number,
  ) => void,
) {
  const ledger: IdentityLedger = {
    commit: async ({ command, facts }) => {
      committed.push({ command, facts });
      afterCommit?.(facts, command.data.occurredAtMs);
      return facts.map((fact) => occurred(fact, command.data.occurredAtMs));
    },
  };
  return ledger;
}

interface IdentityCommandRecord {
  command: IdentityCommand;
  facts: readonly IdentityFactInput[];
}

function identityServiceFor(
  identifiers: IdentityHeads["identifiers"],
  committed: IdentityCommandRecord[],
  projected?: { current: IdentityHeads },
  account?: AccountState,
) {
  const heads = new Heads({ userId: USER_ID, identifiers }, projected);
  const guards = new IdentityGuards(heads, new Users(), new Reservations());
  return new IdentityService(
    guards,
    ledgerThatRecords(committed, (facts, occurredAt) => {
      heads.fold(facts, occurredAt);
      if (!account) return;
      const active = Object.values(
        projected?.current.identifiers ?? identifiers,
      ).filter(
        (identifier) =>
          identifier.state === "VERIFIED" || identifier.state === "PRIMARY",
      );
      account.current = {
        hasPassword: active.some(
          (identifier) => identifier.provider === "email",
        ),
        hasPasskey: active.some(
          (identifier) => identifier.provider === "passkey",
        ),
        providerIds: active.flatMap((identifier) =>
          identifier.provider === "email" || identifier.provider === "passkey"
            ? []
            : [identifier.provider],
        ),
        connectionIds: active.flatMap((identifier) =>
          identifier.connectionId ? [identifier.connectionId] : [],
        ),
      };
      const methods = account.current;
      if (!methods) return;
      const allIdentifiers = Object.values(
        projected?.current.identifiers ?? identifiers,
      );
      account.byAddress = new Map(
        allIdentifiers.flatMap((identifier) =>
          identifier.value === null
            ? []
            : [
                [
                  identifier.value,
                  active.includes(identifier) ? methods : null,
                ] as const,
              ],
        ),
      );
    }),
  );
}

function proposal({
  decision = null,
}: {
  decision?: LinkProposalRecord["decision"];
} = {}) {
  return {
    proposalId: "proposal_1",
    userId: USER_ID,
    connectionId: "ssoc_acme",
    provider: "oidc" as const,
    providerAccountId: "subject_1",
    value: "sam@acme.com",
    domain: "acme.com",
    reason: "unverified_orphan" as const,
    proposedAtMs: NOW - 1_000,
    decision,
  } satisfies LinkProposalRecord;
}

function linksFor(
  record: LinkProposalRecord,
  committed: IdentityCommandRecord[],
  linked: { calls: LinkCall[] },
  account?: AccountState,
) {
  const proposals: LinkProposalReadsRepository = {
    findProposal: async () => record,
    findProposals: async () => [record],
  };
  const directory = {
    linkProviderAccount: async (input: LinkCall) => {
      linked.calls.push(input);
      if (account) {
        account.current = {
          hasPassword: false,
          hasPasskey: false,
          providerIds: [input.provider],
          connectionIds: input.connectionId ? [input.connectionId] : [],
        };
        account.byAddress ??= new Map();
        account.byAddress.set(input.normalizedEmail, account.current);
      }
    },
  };
  return new LinkProposalService({
    guards: new LinkProposalGuards({ proposals }),
    proposals,
    directory,
    ledger: ledgerThatRecords(committed),
  });
}

interface LinkCall {
  userId: string;
  connectionId: string | null;
  provider: string;
  subject: string;
  normalizedEmail: string;
}

interface AccountState {
  current: AccountSignInMethods | null;
  byAddress?: Map<string, AccountSignInMethods | null>;
}

function router(account: AccountState = { current: null }) {
  return new SignInRouterService({
    domains: {
      findConnectionForDomain: async () => null,
      listActiveConnections: async () => [],
    },
    policy: {
      resolvePolicy: async () => ({
        defaultMethods: [
          {
            id: "password",
            kind: "password" as const,
            connectionId: null,
          },
          {
            id: "oidc",
            kind: "federated" as const,
            connectionId: "ssoc_acme",
          },
        ],
        localMethods: [
          {
            id: "password",
            kind: "password" as const,
            connectionId: null,
          },
        ],
        federationLicensed: true,
        selfHosted: false,
      }),
    },
    breakGlass: { allow: async () => false },
    accounts: {
      findAccountMethods: async ({ normalizedValue }) =>
        account.byAddress?.has(normalizedValue)
          ? (account.byAddress.get(normalizedValue) ?? null)
          : account.current,
    },
  });
}

function readsFor({
  identifiers = [],
  invitations = [],
}: {
  identifiers?: readonly LookupIdentifierRow[];
  invitations?: readonly {
    inviteId: string;
    email: string;
    organizationId: string;
    organizationName: string | null;
    invitedByName: string | null;
    status: string;
    expiresAtMs: number | null;
    createdAtMs: number;
  }[];
} = {}): IdentityLookupReadsRepository {
  return {
    findIdentifiersByValue: async () => identifiers,
    findIdentifiersForUser: async () => identifiers,
    findUsers: async ({ userIds }) =>
      userIds.map((userId) => ({
        userId,
        name: "Sam Carter",
        email: "sam@acme.com",
      })),
    findMemberships: async ({ userIds }) =>
      userIds.map((userId) => ({
        userId,
        organizationId: "org_acme",
        organizationName: "Acme",
        role: "MEMBER",
      })),
    findOrganizationNames: async () => new Map(),
    findSessions: async () => [],
    findInvitations: async () => invitations,
    findClaimsAwaitingReview: async () => [],
    findClaimQueue: async () => [],
    findConnectionForDomain: async () => null,
    findRecentOperatorActivity: async () => [],
  };
}

const history: IdentityHistoryReadsRepository = {
  findHistory: async () => [],
};

describe("platform operator identity lookup service", () => {
  describe("when a sign-in proposal is waiting", () => {
    /** @scenario "Confirming a proposed sign-in attaches the method and lets the person in" */
    it("uses the ordinary link ceremony and records the operator actor", async () => {
      const committed: IdentityCommandRecord[] = [];
      const linked = { calls: [] as LinkCall[] };
      const account = { current: null as AccountSignInMethods | null };
      const service = new IdentityLookupService({
        reads: readsFor(),
        history,
        proposals: {
          findProposal: async () => proposal(),
          findProposals: async () => [proposal()],
        },
        router: () => router(account),
        identity: () => identityServiceFor({}, committed),
        links: () => linksFor(proposal(), committed, linked, account),
        sessions: {
          endAllForUser: async () => {},
          endForIdentifier: async () => {},
        },
        invitations: {
          resend: async () => ({ expiresAtMs: null }),
          extend: async () => ({ expiresAtMs: null }),
        },
        now: () => NOW,
      });

      await service.confirmProposedSignIn({
        userId: USER_ID,
        proposalId: "proposal_1",
        operator: { userId: OPERATOR_ID },
      });

      expect(linked.calls).toEqual([
        {
          userId: USER_ID,
          connectionId: "ssoc_acme",
          provider: "oidc",
          subject: "subject_1",
          normalizedEmail: "sam@acme.com",
        },
      ]);
      expect(committed[0]?.command.data).toMatchObject({
        tenantId: USER_ID,
        userId: USER_ID,
        actor: { type: "user", id: OPERATOR_ID },
        occurredAtMs: NOW,
      });
      expect(committed[0]?.facts[0]).toMatchObject({
        type: "lw.identity.link_confirmed",
        data: {
          proposalId: "proposal_1",
          userId: USER_ID,
          actor: { type: "user", id: OPERATOR_ID },
        },
      });

      const nextSignIn = await router(account).route({
        identifier: "sam@acme.com",
      });
      expect(nextSignIn).toMatchObject({
        outcome: "method_picker",
        reasonCode: "account_methods",
      });
      expect(nextSignIn.methodSet.map((method) => method.id)).toEqual(["oidc"]);
    });

    /** @scenario "Rejecting a proposed sign-in records the decision and changes nothing else" */
    it("records rejection with the operator and does not link an account", async () => {
      const committed: IdentityCommandRecord[] = [];
      const linked = { calls: [] as LinkCall[] };
      const pending = proposal();
      const service = new IdentityLookupService({
        reads: readsFor(),
        history,
        proposals: {
          findProposal: async () => pending,
          findProposals: async () => [pending],
        },
        router,
        identity: () => identityServiceFor({}, committed),
        links: () => linksFor(pending, committed, linked),
        sessions: {
          endAllForUser: async () => {},
          endForIdentifier: async () => {},
        },
        invitations: {
          resend: async () => ({ expiresAtMs: null }),
          extend: async () => ({ expiresAtMs: null }),
        },
        now: () => NOW,
      });

      await service.rejectProposedSignIn({
        userId: USER_ID,
        proposalId: "proposal_1",
        operator: { userId: OPERATOR_ID },
      });

      expect(linked.calls).toEqual([]);
      expect(committed[0]?.command.data.actor).toEqual({
        type: "user",
        id: OPERATOR_ID,
      });
      expect(committed[0]?.command.data).toMatchObject({
        tenantId: USER_ID,
        userId: USER_ID,
      });
      expect(committed[0]?.facts[0]?.type).toBe("lw.identity.link_rejected");
    });

    /** @scenario "A proposal somebody already decided cannot be decided twice" */
    it("passes the guard's named refusal through without a second decision", async () => {
      const committed: IdentityCommandRecord[] = [];
      const decided = proposal({
        decision: {
          outcome: "confirmed",
          byActorId: "user_ash",
          atMs: NOW - 500,
        },
      });
      const service = new IdentityLookupService({
        reads: readsFor(),
        history,
        proposals: {
          findProposal: async () => decided,
          findProposals: async () => [decided],
        },
        router,
        identity: () => identityServiceFor({}, committed),
        links: () => linksFor(decided, committed, { calls: [] }),
        sessions: {
          endAllForUser: async () => {},
          endForIdentifier: async () => {},
        },
        invitations: {
          resend: async () => ({ expiresAtMs: null }),
          extend: async () => ({ expiresAtMs: null }),
        },
        now: () => NOW,
      });

      await expect(
        service.confirmProposedSignIn({
          userId: USER_ID,
          proposalId: "proposal_1",
          operator: { userId: OPERATOR_ID },
        }),
      ).rejects.toMatchObject({
        code: "identity_link_proposal_resolved",
        message: "identity_link_proposal_resolved",
        meta: {
          decidedByActorId: "user_ash",
          decidedOutcome: "confirmed",
        },
      });
      expect(committed).toEqual([]);
    });
  });

  describe("when a sign-in method is detached", () => {
    /** @scenario "Detaching somebody's last way in is refused" */
    it("leaves the last method in place and returns the named guard refusal", async () => {
      const committed: IdentityCommandRecord[] = [];
      const service = new IdentityLookupService({
        reads: readsFor(),
        history,
        proposals: {
          findProposal: async () => null,
          findProposals: async () => [],
        },
        router,
        identity: () =>
          identityServiceFor(
            {
              idf_work: {
                identifierId: "idf_work",
                userId: USER_ID,
                provider: "email",
                value: "sam@acme.com",
                domain: "acme.com",
                identifierHash: null,
                accountId: null,
                providerId: null,
                issuer: null,
                providerAccountId: null,
                connectionId: null,
                state: "VERIFIED",
                verifiedAtMs: NOW,
                attachedAtMs: NOW,
                detachedAtMs: null,
              },
            },
            committed,
          ),
        links: () => linksFor(proposal(), committed, { calls: [] }),
        sessions: {
          endAllForUser: async () => {},
          endForIdentifier: async () => {},
        },
        invitations: {
          resend: async () => ({ expiresAtMs: null }),
          extend: async () => ({ expiresAtMs: null }),
        },
        now: () => NOW,
      });

      await expect(
        service.detachMethod({
          userId: USER_ID,
          identifierId: "idf_work",
          operator: { userId: OPERATOR_ID },
        }),
      ).rejects.toMatchObject({
        code: "identity_detach_strands_user",
        message: "identity_detach_strands_user",
      });
      expect(committed).toEqual([]);
    });

    /** @scenario "Detaching a method somebody has a replacement for takes effect and is recorded" */
    it("commands the detach when another working method remains", async () => {
      const committed: IdentityCommandRecord[] = [];
      const identifiers = {
        idf_work: {
          identifierId: "idf_work",
          userId: USER_ID,
          provider: "email" as const,
          value: "sam@acme.com",
          domain: "acme.com",
          identifierHash: null,
          accountId: null,
          providerId: null,
          issuer: null,
          providerAccountId: null,
          connectionId: null,
          state: "VERIFIED" as const,
          verifiedAtMs: NOW,
          attachedAtMs: NOW,
          detachedAtMs: null,
        },
        idf_personal: {
          identifierId: "idf_personal",
          userId: USER_ID,
          provider: "email" as const,
          value: "sam@example.com",
          domain: "example.com",
          identifierHash: null,
          accountId: null,
          providerId: null,
          issuer: null,
          providerAccountId: null,
          connectionId: null,
          state: "VERIFIED" as const,
          verifiedAtMs: NOW,
          attachedAtMs: NOW,
          detachedAtMs: null,
        },
      };
      const projected = {
        current: { userId: USER_ID, identifiers },
      };
      const account = { current: null as AccountSignInMethods | null };
      const service = new IdentityLookupService({
        reads: readsFor(),
        history,
        proposals: {
          findProposal: async () => null,
          findProposals: async () => [],
        },
        router: () => router(account),
        identity: () =>
          identityServiceFor(identifiers, committed, projected, account),
        links: () => linksFor(proposal(), committed, { calls: [] }),
        sessions: {
          endAllForUser: async () => {},
          endForIdentifier: async () => {},
        },
        invitations: {
          resend: async () => ({ expiresAtMs: null }),
          extend: async () => ({ expiresAtMs: null }),
        },
        now: () => NOW,
      });

      await service.detachMethod({
        userId: USER_ID,
        identifierId: "idf_personal",
        operator: { userId: OPERATOR_ID },
      });

      expect(committed[0]?.command.data.actor).toEqual({
        type: "user",
        id: OPERATOR_ID,
      });
      expect(committed[0]?.command.data).toMatchObject({
        tenantId: USER_ID,
        userId: USER_ID,
      });
      expect(committed[0]?.facts[0]).toMatchObject({
        type: "lw.identity.identifier_detached",
        data: { identifierId: "idf_personal" },
      });
      expect(projected.current.identifiers.idf_personal?.state).toBe(
        "DETACHED",
      );
      expect(projected.current.identifiers.idf_work?.state).toBe("VERIFIED");

      const nextSignIn = await router(account).route({
        identifier: "sam@acme.com",
      });
      expect(nextSignIn).toMatchObject({
        outcome: "method_picker",
        reasonCode: "account_methods",
      });
      expect(nextSignIn.methodSet.map((method) => method.id)).toEqual([
        "password",
      ]);

      const detachedSignIn = await router(account).route({
        identifier: "sam@example.com",
      });
      expect(detachedSignIn).toMatchObject({
        outcome: "route_to_signup",
        reasonCode: "identifier_unknown",
      });
    });
  });

  describe("when sessions are ended", () => {
    it("routes method-only and person-wide revocation to the session boundary", async () => {
      const endAllForUser = vi.fn(async () => {});
      const endForIdentifier = vi.fn(async () => {});
      const service = new IdentityLookupService({
        reads: readsFor(),
        history,
        proposals: {
          findProposal: async () => null,
          findProposals: async () => [],
        },
        router,
        identity: () => identityServiceFor({}, []),
        links: () => linksFor(proposal(), [], { calls: [] }),
        sessions: { endAllForUser, endForIdentifier },
        invitations: {
          resend: async () => ({ expiresAtMs: null }),
          extend: async () => ({ expiresAtMs: null }),
        },
        now: () => NOW,
      });

      await service.endSessions({ userId: USER_ID, identifierId: "idf_work" });
      await service.endSessions({ userId: USER_ID, identifierId: null });

      expect(endForIdentifier).toHaveBeenCalledWith({
        userId: USER_ID,
        identifierId: "idf_work",
      });
      expect(endAllForUser).toHaveBeenCalledWith({ userId: USER_ID });
    });
  });

  describe("when invitations are shown and repaired", () => {
    /** @scenario "Outstanding invitations are listed with what is left of them" */
    it("lists the organisation, sender, and derived expired state", async () => {
      const expiresAtMs = NOW - 1_000;
      const invitation = {
        inviteId: "invite_1",
        email: "sam@acme.com",
        organizationId: "org_acme",
        organizationName: "Acme",
        invitedByName: "Ada Lovelace",
        status: "PENDING",
        expiresAtMs,
        createdAtMs: NOW - 10_000,
      };
      const service = new IdentityLookupService({
        reads: readsFor({
          identifiers: [
            {
              identifierId: "idf_work",
              userId: USER_ID,
              provider: "email",
              value: "sam@acme.com",
              domain: "acme.com",
              state: "VERIFIED",
              connectionId: null,
              verifiedAtMs: NOW,
              attachedAtMs: NOW,
              detachedAtMs: null,
            },
          ],
          invitations: [invitation],
        }),
        history,
        proposals: {
          findProposal: async () => null,
          findProposals: async () => [],
        },
        router,
        identity: () => identityServiceFor({}, []),
        links: () => linksFor(proposal(), [], { calls: [] }),
        sessions: {
          endAllForUser: async () => {},
          endForIdentifier: async () => {},
        },
        invitations: {
          resend: async () => ({ expiresAtMs: null }),
          extend: async () => ({ expiresAtMs: null }),
        },
        now: () => NOW,
      });

      const detail = await service.person({
        userId: USER_ID,
        address: "sam@acme.com",
      });

      expect(detail?.waiting.invitations).toEqual([
        expect.objectContaining({
          organizationName: "Acme",
          invitedByName: "Ada Lovelace",
          expiresAtMs,
          isExpired: true,
        }),
      ]);
    });

    /** @scenario "Resending an invitation from here does what resending does anywhere" */
    it("delegates resend and returns the fresh expiry", async () => {
      const resend = vi.fn(async () => ({
        expiresAtMs: NOW + 14 * 24 * 60 * 60 * 1000,
      }));
      const service = new IdentityLookupService({
        reads: readsFor(),
        history,
        proposals: {
          findProposal: async () => null,
          findProposals: async () => [],
        },
        router,
        identity: () => identityServiceFor({}, []),
        links: () => linksFor(proposal(), [], { calls: [] }),
        sessions: {
          endAllForUser: async () => {},
          endForIdentifier: async () => {},
        },
        invitations: { resend, extend: async () => ({ expiresAtMs: null }) },
        now: () => NOW,
      });

      await expect(
        service.resendInvitation({
          organizationId: "org_acme",
          inviteId: "invite_1",
        }),
      ).resolves.toEqual({ expiresAtMs: NOW + 14 * 24 * 60 * 60 * 1000 });
      expect(resend).toHaveBeenCalledWith({
        organizationId: "org_acme",
        inviteId: "invite_1",
      });
    });

    /** @scenario "Extending an invitation moves its expiry and says by how much" */
    it("delegates extension and returns the new date", async () => {
      const extend = vi.fn(async () => ({
        expiresAtMs: NOW + 7 * 24 * 60 * 60 * 1000,
      }));
      const service = new IdentityLookupService({
        reads: readsFor(),
        history,
        proposals: {
          findProposal: async () => null,
          findProposals: async () => [],
        },
        router,
        identity: () => identityServiceFor({}, []),
        links: () => linksFor(proposal(), [], { calls: [] }),
        sessions: {
          endAllForUser: async () => {},
          endForIdentifier: async () => {},
        },
        invitations: { resend: async () => ({ expiresAtMs: null }), extend },
        now: () => NOW,
      });

      await expect(
        service.extendInvitation({
          organizationId: "org_acme",
          inviteId: "invite_1",
        }),
      ).resolves.toEqual({ expiresAtMs: NOW + 7 * 24 * 60 * 60 * 1000 });
      expect(extend).toHaveBeenCalledWith({
        organizationId: "org_acme",
        inviteId: "invite_1",
      });
    });
  });
});
