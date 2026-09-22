import type { AuditLogApi, RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import type { IdentifierFact, SsoConnectionState } from "@langwatch/identity-contract";
import type { RateLimiter } from "@langwatch/process-stores";
import { beforeEach, describe, expect, it } from "vitest";

import { MemoryIdentityStore } from "../repositories/memory/memory-identity.store.ts";
import { MemoryIdentityLookupRepository } from "../repositories/memory/memory.identity-lookup.repository.ts";
import type { SsoPlatformOperatorRepository } from "../repositories/sso-connection.repository.ts";
import {
  IdentityLookupRefusedError,
  IdentityLookupService,
} from "../services/identity-lookup.service.ts";

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

  async record(command: RecordAuditLogCommand): Promise<void> {
    this.rows.unshift(command);
    this.reads.record({
      auditId: `audit_${this.rows.length}`,
      operatorUserId: command.userId,
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
    router: () => ({ route: async () => CONNECTED_ROUTE }),
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
      await service.resolve({ address: "sam@acme.com", operator: OLIVE });

      expect(auditLog.rows).toHaveLength(1);
      expect(auditLog.rows[0]?.userId).toBe(OLIVE.userId);
      expect(before).toBeLessThanOrEqual(Date.now());
    });

    /** @scenario "One address answers the question the auth screens would answer" */
    it("shows the routing decision the auth screens would reach", async () => {
      const answer = await service.resolve({ address: "sam@acme.com", operator: OLIVE });

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

      const answer = await service.resolve({ address: "sam@acme.com", operator: OLIVE });

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

      const answer = await service.resolve({ address: "sam@acme.com", operator: OLIVE });

      expect(answer.people.map((person) => person.userId).toSorted()).toEqual(["user_1", "user_2"]);
    });
  });

  describe("when mallory holds no platform operator access", () => {
    /** @scenario "A refused lookup is recorded as an attempt, and reveals nothing" */
    it("refuses the request and records only that she made an attempt", async () => {
      await expect(service.resolve({ address: "sam@acme.com", operator: MALLORY })).rejects.toThrow(
        IdentityLookupRefusedError,
      );

      expect(auditLog.rows).toHaveLength(1);
      expect(auditLog.rows[0]?.userId).toBe(MALLORY.userId);
    });
  });

  describe("when several operators have resolved addresses today", () => {
    /** @scenario "Who looked somebody up is readable by an operator, on this surface" */
    it("reads who resolved which address, off the same trail the repairs write to", async () => {
      await service.resolve({ address: "sam@acme.com", operator: OLIVE });
      await service.resolve({ address: "sam2@acme.com", operator: OLIVE });

      const activity = await service.recentActivity({ operator: OLIVE });

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
