/**
 * @vitest-environment node
 *
 * The platform operator's identity lookup: what one address answers, and
 * what each repair does when it runs.
 *
 * The detach tests compose the REAL guards over in-memory heads rather than
 * a stub, because the property under test is that this surface renders the
 * guards' refusal instead of deciding for itself — a stubbed guard would
 * pass whatever this file told it to.
 *
 * Corresponds to specs/identity/platform-ops-identity-lookup.feature.
 */
import {
  emptyIdentityHeads,
  type IdentifierFact,
  type IdentifierProvider,
  type IdentityCommand,
  type IdentityFact,
  type IdentityFactInput,
  type IdentityHeads,
} from "@langwatch/identity";
import {
  IdentityGuards,
  IdentityService,
  type LinkProposalReadsRepository,
  type LinkProposalRecord,
  type LinkProposalService,
  type SignInRouterService,
} from "@langwatch/identity-server";
import { describe, expect, it } from "vitest";
import {
  IdentityLookupService,
  type OperatorInvitationPort,
  type OperatorSessionPort,
} from "../identity-lookup.service";
import type {
  IdentityHistoryEntry,
  IdentityHistoryReadsRepository,
} from "../repositories/identity-event-log.repository";
import type {
  IdentityLookupReadsRepository,
  LookupConnectionRow,
  LookupDomainClaimRow,
  LookupIdentifierRow,
  LookupInvitationRow,
  LookupMembershipRow,
  LookupOperatorActivityRow,
  LookupSessionRow,
  LookupUserRow,
} from "../repositories/identity-lookup.prisma.repository";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const OPERATOR = { userId: "user_olive" };

interface WorldSeed {
  identifiers?: LookupIdentifierRow[];
  users?: LookupUserRow[];
  memberships?: LookupMembershipRow[];
  sessions?: LookupSessionRow[];
  invitations?: LookupInvitationRow[];
  claims?: LookupDomainClaimRow[];
  claimQueue?: LookupDomainClaimRow[];
  connection?: LookupConnectionRow | null;
  activity?: LookupOperatorActivityRow[];
  organizationNames?: Record<string, string>;
}

class FakeReads implements IdentityLookupReadsRepository {
  constructor(private readonly seed: WorldSeed) {}

  async findIdentifiersByValue({ value }: { value: string }) {
    return (this.seed.identifiers ?? []).filter((row) => row.value === value);
  }
  async findIdentifiersForUser({ userId }: { userId: string }) {
    return (this.seed.identifiers ?? []).filter((row) => row.userId === userId);
  }
  async findUsers({ userIds }: { userIds: readonly string[] }) {
    return (this.seed.users ?? []).filter((row) =>
      userIds.includes(row.userId),
    );
  }
  async findMemberships({ userIds }: { userIds: readonly string[] }) {
    return (this.seed.memberships ?? []).filter((row) =>
      userIds.includes(row.userId),
    );
  }
  async findOrganizationNames({
    organizationIds,
  }: {
    organizationIds: readonly string[];
  }) {
    return new Map(
      Object.entries(this.seed.organizationNames ?? {}).filter(([id]) =>
        organizationIds.includes(id),
      ),
    );
  }
  async findSessions({ userId }: { userId: string }) {
    return (this.seed.sessions ?? []).filter(() => userId.length > 0);
  }
  async findInvitations({ email }: { email: string }) {
    return (this.seed.invitations ?? []).filter(
      (row) => row.email.toLowerCase() === email.toLowerCase(),
    );
  }
  async findClaimsAwaitingReview({ domains }: { domains: readonly string[] }) {
    return (this.seed.claims ?? []).filter((row) =>
      domains.includes(row.domain),
    );
  }
  async findClaimQueue({ limit }: { limit: number }) {
    return (this.seed.claimQueue ?? []).slice(0, limit);
  }
  async findConnectionForDomain(): Promise<LookupConnectionRow | null> {
    return this.seed.connection ?? null;
  }
  async findRecentOperatorActivity({ limit }: { limit: number }) {
    return (this.seed.activity ?? []).slice(0, limit);
  }
}

class FakeHistory implements IdentityHistoryReadsRepository {
  constructor(private readonly entries: IdentityHistoryEntry[] = []) {}
  async findHistory({ limit }: { userId: string; limit: number }) {
    return this.entries.slice(0, limit);
  }
}

class FakeProposals implements LinkProposalReadsRepository {
  constructor(private readonly proposals: LinkProposalRecord[] = []) {}
  async findProposal() {
    return this.proposals[0] ?? null;
  }
  async findProposals() {
    return this.proposals;
  }
}

/** The real guards, over heads a test states directly. */
class InMemoryHeads {
  constructor(private readonly heads: Map<string, IdentityHeads>) {}
  async findUserHashKey() {
    return null;
  }
  async findHeads({ userId }: { userId: string }) {
    return this.heads.get(userId) ?? emptyIdentityHeads({ userId });
  }
  async findActiveIdentifierByValue() {
    return null;
  }
  async findIdentifier() {
    return null;
  }
  async findIdentifierIdForAccount() {
    return null;
  }
}

class RecordingLedger {
  readonly commits: { command: IdentityCommand; facts: IdentityFactInput[] }[] =
    [];
  async commit({
    command,
    facts,
  }: {
    command: IdentityCommand;
    facts: IdentityFactInput[];
  }): Promise<IdentityFact[]> {
    this.commits.push({ command, facts });
    return facts.map((fact) => ({ ...fact, occurredAt: NOW }) as IdentityFact);
  }
}

class RecordingSessions implements OperatorSessionPort {
  readonly all: string[] = [];
  readonly perMethod: { userId: string; identifierId: string }[] = [];
  async endAllForUser({ userId }: { userId: string }) {
    this.all.push(userId);
  }
  async endForIdentifier(input: { userId: string; identifierId: string }) {
    this.perMethod.push(input);
  }
}

class RecordingInvitations implements OperatorInvitationPort {
  readonly resent: { organizationId: string; inviteId: string }[] = [];
  readonly extended: { organizationId: string; inviteId: string }[] = [];
  async resend(input: { organizationId: string; inviteId: string }) {
    this.resent.push(input);
    return { expiresAtMs: NOW + 14 * DAY };
  }
  async extend(input: { organizationId: string; inviteId: string }) {
    this.extended.push(input);
    return { expiresAtMs: NOW + 14 * DAY };
  }
}

function identifierRow(
  overrides: Partial<LookupIdentifierRow> = {},
): LookupIdentifierRow {
  return {
    identifierId: "idf_1",
    userId: "user_sam",
    provider: "email",
    value: "sam@acme.com",
    domain: "acme.com",
    state: "VERIFIED",
    connectionId: null,
    verifiedAtMs: NOW - DAY,
    attachedAtMs: NOW - 2 * DAY,
    detachedAtMs: null,
    ...overrides,
  };
}

function head(overrides: Partial<IdentifierFact> = {}): IdentifierFact {
  return {
    identifierId: "idf_1",
    userId: "user_sam",
    accountId: null,
    provider: "email" as IdentifierProvider,
    providerAccountId: null,
    value: "sam@acme.com",
    identifierHash: null,
    domain: "acme.com",
    connectionId: null,
    state: "VERIFIED",
    attachedAt: NOW - 2 * DAY,
    verifiedAt: NOW - DAY,
    detachedAt: null,
    ...overrides,
  } as IdentifierFact;
}

function headsFor(identifiers: IdentifierFact[]): Map<string, IdentityHeads> {
  return new Map([
    [
      "user_sam",
      {
        ...emptyIdentityHeads({ userId: "user_sam" }),
        identifiers: Object.fromEntries(
          identifiers.map((identifier) => [
            identifier.identifierId,
            identifier,
          ]),
        ),
      },
    ],
  ]);
}

function build({
  seed = {},
  history = [],
  proposals = [],
  heads = headsFor([head()]),
  decision = {
    outcome: "method_picker" as const,
    reasonCode: "no_domain_match" as const,
    methodSet: [
      { id: "password", kind: "password" as const, connectionId: null },
    ],
  },
}: {
  seed?: WorldSeed;
  history?: IdentityHistoryEntry[];
  proposals?: LinkProposalRecord[];
  heads?: Map<string, IdentityHeads>;
  decision?: {
    outcome: "method_picker" | "redirect_to_connection";
    reasonCode: string;
    connectionId?: string;
    methodSet: {
      id: string;
      kind: "password" | "federated";
      connectionId: string | null;
    }[];
  };
} = {}) {
  const ledger = new RecordingLedger();
  const sessions = new RecordingSessions();
  const invitations = new RecordingInvitations();
  const routed: (string | null)[] = [];
  const identity = new IdentityService(
    new IdentityGuards(new InMemoryHeads(heads) as never),
    ledger,
  );
  const links = {
    confirmLink: async () => [],
    rejectLink: async () => [],
  } as unknown as LinkProposalService;

  const service = new IdentityLookupService({
    reads: new FakeReads(seed),
    history: new FakeHistory(history),
    proposals: new FakeProposals(proposals),
    router: () =>
      ({
        route: async ({ identifier }: { identifier: string | null }) => {
          routed.push(identifier);
          return decision;
        },
      }) as unknown as SignInRouterService,
    identity: () => identity,
    links: () => links,
    sessions,
    invitations,
    now: () => NOW,
  });

  return { service, ledger, sessions, invitations, routed };
}

describe("given an address a support case is about", () => {
  describe("when an operator resolves it", () => {
    /** @scenario "One address answers the question the auth screens would answer" */
    it("asks the auth screens' own router rather than deciding again", async () => {
      const { service, routed } = build({
        decision: {
          outcome: "method_picker",
          reasonCode: "connection_suspended",
          methodSet: [{ id: "password", kind: "password", connectionId: null }],
        },
      });

      const answer = await service.resolve({ address: "sam@acme.com" });

      // The raw value goes to the router, which normalizes it the one way
      // that exists. Nothing here re-decides anything.
      expect(routed).toEqual(["sam@acme.com"]);
      expect(answer.routing.reasonCode).toBe("connection_suspended");
      expect(answer.routing.outcome).toBe("method_picker");
    });

    /** @scenario "Every person holding any part of the address is listed" */
    it("lists everybody holding it, with the organizations they belong to", async () => {
      const { service } = build({
        seed: {
          identifiers: [
            identifierRow({ identifierId: "idf_sam", userId: "user_sam" }),
            identifierRow({
              identifierId: "idf_old",
              userId: "user_older",
              state: "DETACHED",
              detachedAtMs: NOW - DAY,
            }),
          ],
          users: [
            { userId: "user_sam", name: "Sam", email: "sam@acme.com" },
            { userId: "user_older", name: "Sam (old)", email: null },
          ],
          memberships: [
            {
              userId: "user_sam",
              organizationId: "org_acme",
              organizationName: "Acme",
              role: "MEMBER",
            },
          ],
        },
      });

      const answer = await service.resolve({ address: "sam@acme.com" });

      // Both, as a list. Neither is "the" answer — presenting one would be
      // how the wrong account gets repaired.
      expect(answer.people.map((person) => person.userId)).toEqual([
        "user_sam",
        "user_older",
      ]);
      expect(answer.people[0]?.organizations).toEqual([
        { organizationId: "org_acme", name: "Acme", role: "MEMBER" },
      ]);
      expect(answer.people[1]?.holding[0]?.state).toBe("DETACHED");
    });

    /** @scenario "The address is resolved the way the auth screens resolves it" */
    it("normalizes with the auth screens' own fold and keeps what was typed", async () => {
      const { service } = build({
        seed: {
          identifiers: [identifierRow({ value: "sam+support@acme.com" })],
          users: [
            {
              userId: "user_sam",
              name: "Sam",
              email: "sam+support@acme.com",
            },
          ],
        },
      });

      const answer = await service.resolve({
        address: "  Sam+Support@ACME.com ",
      });

      // Case and surrounding space fold; the subaddress does not, because
      // the auth screens does not fold it either.
      expect(answer.resolved).toBe("sam+support@acme.com");
      expect(answer.typed).toBe("  Sam+Support@ACME.com ");
      expect(answer.people.map((person) => person.userId)).toEqual([
        "user_sam",
      ]);
    });

    /** @scenario "An organization's own connection state is readable from the person who signs in through it" */
    it("names the connection and its state beside the routing decision", async () => {
      const { service } = build({
        seed: {
          connection: {
            connectionId: "ssoc_acme",
            organizationId: "org_acme",
            organizationName: "Acme",
            state: "SUSPENDED",
            providerId: "acme-okta",
          },
        },
        decision: {
          outcome: "method_picker",
          reasonCode: "connection_suspended",
          methodSet: [{ id: "password", kind: "password", connectionId: null }],
        },
      });

      const answer = await service.resolve({ address: "sam@acme.com" });

      expect(answer.routing.connection).toMatchObject({
        organizationName: "Acme",
        state: "SUSPENDED",
      });
      // The reason and the state agree, because both come from the same
      // connection the router read.
      expect(answer.routing.reasonCode).toBe("connection_suspended");
    });
  });
});

describe("given an operator opening a person", () => {
  describe("when the invitations panel is assembled", () => {
    /** @scenario "Outstanding invitations are listed with what is left of them" */
    it("lists each with its organization, sender and expiry, and says which have lapsed", async () => {
      const { service } = build({
        seed: {
          identifiers: [identifierRow()],
          users: [{ userId: "user_sam", name: "Sam", email: "sam@acme.com" }],
          invitations: [
            {
              inviteId: "inv_live",
              email: "sam@acme.com",
              organizationId: "org_acme",
              organizationName: "Acme",
              invitedByName: "Ada",
              status: "PENDING",
              expiresAtMs: NOW + DAY,
              createdAtMs: NOW - DAY,
            },
            {
              inviteId: "inv_stale",
              email: "sam@acme.com",
              organizationId: "org_acme",
              organizationName: "Acme",
              invitedByName: "Ada",
              status: "PENDING",
              expiresAtMs: NOW - DAY,
              createdAtMs: NOW - 20 * DAY,
            },
          ],
        },
      });

      const detail = await service.person({
        userId: "user_sam",
        address: "sam@acme.com",
      });

      expect(detail?.waiting.invitations).toEqual([
        expect.objectContaining({
          inviteId: "inv_live",
          organizationName: "Acme",
          invitedByName: "Ada",
          isExpired: false,
        }),
        // Past its expiry says so rather than looking live.
        expect.objectContaining({ inviteId: "inv_stale", isExpired: true }),
      ]);
    });
  });
});

describe("given a person with exactly one working sign-in method", () => {
  describe("when an operator detaches it", () => {
    /** @scenario "Detaching somebody's last way in is refused" */
    it("is refused with the stranding code and states no fact", async () => {
      const { service, ledger } = build({ heads: headsFor([head()]) });

      await expect(
        service.detachMethod({
          userId: "user_sam",
          identifierId: "idf_1",
          operator: OPERATOR,
        }),
      ).rejects.toMatchObject({ code: "identity_detach_strands_user" });

      expect(ledger.commits).toEqual([]);
    });
  });
});

describe("given a person holding a work method and a personal one", () => {
  describe("when an operator detaches the personal one", () => {
    /** @scenario "Detaching a method somebody has a replacement for takes effect and is recorded" */
    it("states the detachment with the operator as the actor", async () => {
      const { service, ledger } = build({
        heads: headsFor([
          head(),
          head({
            identifierId: "idf_personal",
            value: "sam@example.com",
            domain: "example.com",
          }),
        ]),
      });

      await service.detachMethod({
        userId: "user_sam",
        identifierId: "idf_personal",
        operator: OPERATOR,
      });

      const commit = ledger.commits[0];
      expect(commit?.command.type).toBe("lw.identity.detach_identifier");
      // The subject is the tenant; the operator is the actor. One history
      // per person, and it says who did this to them.
      expect(commit?.command.data.tenantId).toBe("user_sam");
      expect(commit?.facts).toEqual([
        {
          type: "lw.identity.identifier_detached",
          data: {
            identifierId: "idf_personal",
            actor: { type: "user", id: "user_olive" },
          },
        },
      ]);
    });
  });
});

describe("given a person signed in on two devices through different methods", () => {
  describe("when an operator ends the sessions belonging to one method", () => {
    /** @scenario "Sessions can be ended for a person or for one of their sign-in methods" */
    it("ends that method's sessions, and ends every session when asked for the person", async () => {
      const { service, sessions } = build();

      await service.endSessions({
        userId: "user_sam",
        identifierId: "idf_work",
      });
      expect(sessions.perMethod).toEqual([
        { userId: "user_sam", identifierId: "idf_work" },
      ]);
      expect(sessions.all).toEqual([]);

      await service.endSessions({ userId: "user_sam", identifierId: null });
      expect(sessions.all).toEqual(["user_sam"]);
    });
  });
});

describe("given claims from several organizations waiting", () => {
  describe("when an operator opens the queue", () => {
    /** @scenario "The claims queue puts the longest wait first and says how long it has been" */
    it("puts the longest wait first and carries the time it started waiting", async () => {
      const { service } = build({
        seed: {
          claimQueue: [
            {
              connectionId: "ssoc_old",
              organizationId: "org_old",
              organizationName: null,
              domain: "old.example",
              waitingSinceMs: NOW - 9 * DAY,
            },
            {
              connectionId: "ssoc_new",
              organizationId: "org_new",
              organizationName: null,
              domain: "new.example",
              waitingSinceMs: NOW - DAY,
            },
          ],
          organizationNames: { org_old: "Old Co", org_new: "New Co" },
        },
      });

      const queue = await service.claimQueue();

      expect(queue.map((claim) => claim.domain)).toEqual([
        "old.example",
        "new.example",
      ]);
      expect(queue[0]?.waitingSinceMs).toBe(NOW - 9 * DAY);
      // Named, never an identifier alone.
      expect(queue[0]?.organizationName).toBe("Old Co");
    });
  });
});
