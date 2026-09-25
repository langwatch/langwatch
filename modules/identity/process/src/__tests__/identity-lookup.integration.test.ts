import { createApiFixture } from "@langwatch/api-fixture";
import type {
  AuditLogApi,
  RecordAuditLogCommand,
  RecordedAuditLogEntry,
} from "@langwatch/audit-log-contract";
import type {
  IdentifierFact,
  IdentityHistoryEntry,
  LinkProposalRecord,
  SsoConnectionState,
} from "@langwatch/identity-contract";
import type { RateLimiter } from "@langwatch/process-stores";
import { beforeEach, describe, expect, it } from "vitest";

import { IdentityHistoryRepository } from "../repositories/identity-history.repository.ts";
import { MemoryIdentityLookupRepository } from "../repositories/memory/memory.identity-lookup.repository.ts";
import { MemoryIdentityStore } from "../repositories/memory/memory.identity.store.ts";
import type { SsoPlatformOperatorRepository } from "../repositories/sso-connection.repository.ts";
import {
  IdentityLookupService,
  type IdentityLookupServiceDeps,
} from "../services/identity-lookup.service.ts";
import type { IdentityService } from "../services/identity.service.ts";

/**
 * D05 tier 1 end to end at the read surface: the real service, the real
 * memory repository, and a fake router and audit log standing in.
 */

const OLIVE = { userId: "user_olive" };
const MALLORY = { userId: "user_mallory" };
const CONNECTED_ROUTE = {
  outcome: "redirect_to_connection" as const,
  connectionId: "ssoc_1",
  reasonCode: "domain_routed" as const,
  methodSet: [{ id: "ssoc_1", kind: "federated" as const, connectionId: "ssoc_1" }],
};

class FakeAuditLog implements AuditLogApi {
  readonly rows: RecordAuditLogCommand[] = [];
  constructor(private readonly reads: MemoryIdentityLookupRepository) {}

  async record(command: RecordAuditLogCommand): Promise<RecordedAuditLogEntry> {
    await this.write(command);
    return { id: "audit", occurredAt: 0 };
  }

  async hasRecordedSince(): Promise<boolean> {
    return false;
  }

  private async write(command: RecordAuditLogCommand): Promise<void> {
    this.rows.unshift(command);
    this.reads.record({
      auditId: `audit_${this.rows.length}`,
      operatorUserId: command.userId ?? null,
      operatorName: null,
      act: command.action.replace("identityLookup.", ""),
      address: null,
      atMs: Date.now(),
    });
  }

  async listEntityHistory() {
    return [];
  }
}

class FakeOperators implements SsoPlatformOperatorRepository {
  constructor(private readonly operatorIds: Set<string>) {}
  async isPlatformOperator({ actorId }: { actorId: string }): Promise<boolean> {
    return this.operatorIds.has(actorId);
  }
}

function noopRateLimiter(): RateLimiter {
  return { check: async () => ({ allowed: true }) };
}

/** A person with no identity facts on the log yet. */
class EmptyIdentityHistory extends IdentityHistoryRepository {
  async findHistory(): Promise<readonly IdentityHistoryEntry[]> {
    return [];
  }

  async findProposals(): Promise<readonly LinkProposalRecord[]> {
    return [];
  }
}

let store: MemoryIdentityStore;
let reads: MemoryIdentityLookupRepository;
let auditLog: FakeAuditLog;
let service: IdentityLookupService;

beforeEach(() => {
  store = MemoryIdentityStore.create();
  reads = MemoryIdentityLookupRepository.create(store);
  auditLog = new FakeAuditLog(reads);
  service = IdentityLookupService.create({
    reads,
    router: { route: async () => CONNECTED_ROUTE },
    history: new EmptyIdentityHistory(),
    identity: () => createApiFixture<Pick<IdentityService, "detachIdentifier">>({}),
    sessions: createApiFixture<IdentityLookupServiceDeps["sessions"]>({
      listBrowserSessions: async () => [],
    }),
    invitations: createApiFixture<IdentityLookupServiceDeps["invitations"]>({}),
    platformOperators: new FakeOperators(new Set([OLIVE.userId])),
    auditLog,
    rateLimiter: noopRateLimiter(),
  });
});

describe("identity lookup, end to end at the read surface", () => {
  describe("when olive resolves an address across organizations", () => {
    /** @scenario "Resolving an address across organizations is recorded as an act" */
    it("writes a record naming her, the address and when, whatever she finds", async () => {
      const before = Date.now();
      await service.lookupAddress({ address: "sam@acme.com", operator: OLIVE });

      expect(auditLog.rows).toHaveLength(1);
      expect(auditLog.rows[0]?.userId).toBe(OLIVE.userId);
      expect(before).toBeLessThanOrEqual(Date.now());
    });

    /** @scenario "One address answers the question the auth screens would answer" */
    it("shows the routing decision the auth screens would reach", async () => {
      const answer = await service.lookupAddress({ address: "sam@acme.com", operator: OLIVE });

      expect(answer.routing.outcome).toBe("redirect_to_connection");
      expect(answer.routing.reasonCode).toBe("domain_routed");
    });

    /** @scenario "An organization's own connection state is readable from the person who signs in through it" */
    it("names the connection and its state beside the routing decision", async () => {
      store.ssoConnections.set("ssoc_1", {
        connectionId: "ssoc_1",
        organizationId: "org_acme",
        type: "oidc",
        state: "SUSPENDED",
        claimedDomains: [],
        domainClaims: [],
        approvedDomains: [],
        verifiedDomains: ["acme.com"],
        domainVerifications: [],
        pendingVerification: null,
        idpMetadata: {
          issuer: "https://acme.okta.com",
          providerId: "okta",
          clientIdRef: "cred_client",
          secretRef: "cred_secret",
          certRefs: [],
        },
        arrivalPolicy: "refuse",
        arrivalPolicyDecidedAtMs: null,
        source: "self-serve",
        testLoginAccountId: null,
        rejection: null,
        createdBy: null,
        createdAtMs: 1,
        updatedAtMs: 1,
        tearDownAfterMs: null,
        replacesConnectionId: null,
        migrationPhase: null,
        graceStartedAtMs: null,
        routeChangedAtMs: null,
        finalizationRequestedAtMs: null,
        finalizedAtMs: null,
      } satisfies SsoConnectionState);
      store.organizationNames.set("org_acme", "Acme");

      const answer = await service.lookupAddress({ address: "sam@acme.com", operator: OLIVE });

      expect(answer.routing.connection?.state).toBe("SUSPENDED");
      expect(answer.routing.connection?.organizationName).toBe("Acme");
    });
  });

  describe("when every person holding any part of the address is asked for", () => {
    /** @scenario "Every person holding any part of the address is listed" */
    it("lists both holders, neither as the only answer", async () => {
      store.identifiers.set(
        "id_1",
        identifierRow({ identifierId: "id_1", userId: "user_1", state: "VERIFIED" }),
      );
      store.identifiers.set(
        "id_2",
        identifierRow({ identifierId: "id_2", userId: "user_2", state: "DETACHED" }),
      );
      reads.users.set("user_1", { userId: "user_1", name: "Sam", email: "sam@acme.com" });
      reads.users.set("user_2", { userId: "user_2", name: "Sam Former", email: null });

      const answer = await service.lookupAddress({ address: "sam@acme.com", operator: OLIVE });

      expect(answer.people.map((person) => person.userId).toSorted()).toEqual(["user_1", "user_2"]);
    });
  });

  describe("when mallory holds no platform operator access", () => {
    /** @scenario "A refused lookup is recorded as an attempt, and reveals nothing" */
    it("refuses the request and records only that she made an attempt", async () => {
      await expect(
        service.lookupAddress({ address: "sam@acme.com", operator: MALLORY }),
      ).rejects.toMatchObject({ code: "identity_lookup_not_found" });

      expect(auditLog.rows).toHaveLength(1);
      expect(auditLog.rows[0]?.userId).toBe(MALLORY.userId);
    });
  });

  describe("when several operators have resolved addresses today", () => {
    /** @scenario "Who looked somebody up is readable by an operator, on this surface" */
    it("reads who resolved which address, off the same trail the repairs write to", async () => {
      await service.lookupAddress({ address: "sam@acme.com", operator: OLIVE });
      await service.lookupAddress({ address: "sam2@acme.com", operator: OLIVE });

      const activity = await service.findLookupActivity({ operator: OLIVE });

      expect(activity.length).toBeGreaterThanOrEqual(2);
      expect(activity.every((row) => row.operatorUserId === OLIVE.userId)).toBe(true);
    });
  });
});

function identifierRow(overrides: {
  identifierId: string;
  userId: string;
  state: IdentifierFact["state"];
}): IdentifierFact {
  return {
    identifierId: overrides.identifierId,
    userId: overrides.userId,
    provider: "credential",
    value: "sam@acme.com",
    domain: "acme.com",
    identifierHash: null,
    accountId: null,
    providerId: null,
    issuer: null,
    providerAccountId: null,
    connectionId: null,
    state: overrides.state,
    verifiedAtMs: null,
    attachedAtMs: 1,
    detachedAtMs: null,
  };
}

describe("identity lookup, the repairs and the panels main's surface serves", () => {
  const ended: string[] = [];

  function repairingService(): IdentityLookupService {
    return IdentityLookupService.create({
      reads,
      history: new EmptyIdentityHistory(),
      router: { route: async () => CONNECTED_ROUTE },
      identity: () => createApiFixture<Pick<IdentityService, "detachIdentifier">>({}),
      platformOperators: new FakeOperators(new Set([OLIVE.userId])),
      auditLog,
      rateLimiter: noopRateLimiter(),
      sessions: createApiFixture<IdentityLookupServiceDeps["sessions"]>({
        listBrowserSessions: async () => [],
        revokeAllBrowserSessions: async ({ userId }: { userId: string }) => {
          ended.push(`all:${userId}`);
        },
        endBrowserSessionsForIdentifier: async ({
          userId,
          identifierId,
        }: {
          userId: string;
          identifierId: string;
        }) => {
          ended.push(`${identifierId}:${userId}`);
          return { ended: 1 };
        },
      }),
      invitations: createApiFixture<IdentityLookupServiceDeps["invitations"]>({
        extendInvitation: async ({ inviteId }: { inviteId: string }) => ({
          invite: invitationRow({ inviteId, expiration: new Date(5_000) }),
        }),
      }),
      now: () => 1_000,
    });
  }

  beforeEach(() => {
    ended.length = 0;
  });

  describe("when olive resolves an address", () => {
    it("answers that she may repair what she finds", async () => {
      const answer = await repairingService().lookupAddress({
        address: "sam@acme.com",
        operator: OLIVE,
      });

      expect(answer.canRepair).toBe(true);
    });
  });

  describe("when olive ends sessions", () => {
    it("ends one method's sessions for an id, and every session for null", async () => {
      const service = repairingService();

      await service.endLookupSessions({
        userId: "user_sam",
        identifierId: "idf_1",
        operator: OLIVE,
      });
      await service.endLookupSessions({ userId: "user_sam", identifierId: null, operator: OLIVE });

      expect(ended).toEqual(["idf_1:user_sam", "all:user_sam"]);
      expect(auditLog.rows.map((row) => row.action)).toEqual([
        "identityLookup.endSessions",
        "identityLookup.endSessions",
      ]);
    });
  });

  describe("when olive extends an invitation", () => {
    it("answers the new expiry and records the act against the invitation", async () => {
      const answer = await repairingService().extendLookupInvitation({
        organizationId: "org_acme",
        inviteId: "inv_1",
        operator: OLIVE,
      });

      expect(answer).toEqual({ expiresAtMs: 5_000 });
      expect(auditLog.rows[0]).toMatchObject({
        userId: OLIVE.userId,
        action: "identityLookup.extendInvitation",
        targetId: "inv_1",
      });
    });
  });

  describe("when somebody outside the staff list asks for the claim queue", () => {
    it("refuses with identity_lookup_not_found", async () => {
      await expect(
        repairingService().findDomainClaimQueue({ operator: MALLORY }),
      ).rejects.toMatchObject({ code: "identity_lookup_not_found" });
    });
  });

  describe("when olive opens a person with nothing waiting on them", () => {
    /** @scenario "Everything waiting on a human is on one panel" */
    it("answers one panel that says it is empty, beside history and sessions", async () => {
      const detail = await repairingService().getLookupPerson({
        userId: "user_sam",
        address: "sam@acme.com",
        operator: OLIVE,
      });

      expect(detail.waiting).toEqual({
        proposals: [],
        invitations: [],
        domainClaims: [],
        isEmpty: true,
      });
      expect(detail.history).toEqual([]);
      expect(detail.sessions).toEqual([]);
    });
  });
});

function invitationRow({ inviteId, expiration }: { inviteId: string; expiration: Date }) {
  return {
    id: inviteId,
    email: "sam@acme.com",
    inviteCode: "code",
    expiration,
    status: "PENDING" as const,
    organizationId: "org_acme",
    teamIds: "",
    teamAssignments: null,
    role: "MEMBER" as const,
    requestedBy: null,
    subscriptionId: null,
    acceptedByUserId: null,
    acceptedViaIdentifierId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}
