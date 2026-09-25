import { createApiFixture } from "@langwatch/api-fixture";
import type {
  AuditLogApi,
  RecordAuditLogCommand,
  RecordedAuditLogEntry,
} from "@langwatch/audit-log-contract";
import { normalizeIdentifierValue } from "@langwatch/identity-contract";
import type { IdentityHistoryEntry, LinkProposalRecord } from "@langwatch/identity-contract";
import type { RateLimiter } from "@langwatch/process-stores";
import { beforeEach, describe, expect, it } from "vitest";

import { IdentityHistoryRepository } from "../../repositories/identity-history.repository.ts";
import { MemoryIdentityLookupRepository } from "../../repositories/memory/memory.identity-lookup.repository.ts";
import { MemoryIdentityStore } from "../../repositories/memory/memory.identity.store.ts";
import type { SsoPlatformOperatorRepository } from "../../repositories/sso-connection.repository.ts";
import {
  IdentityLookupService,
  type IdentityLookupServiceDeps,
} from "../../services/identity-lookup.service.ts";
import type { IdentityService } from "../../services/identity.service.ts";

const OLIVE = { userId: "user_olive" };
const MALLORY = { userId: "user_mallory" };
const NO_ROUTE = {
  outcome: "route_to_signup" as const,
  reasonCode: "identifier_unknown" as const,
  connectionId: undefined as string | undefined,
  methodSet: [],
};

/** Records every write and answers reads from the same array - the trail. */
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
      address:
        typeof command.args === "object" && command.args && "address" in command.args
          ? String((command.args as Record<string, unknown>).address)
          : null,
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

/** Fixed window, in memory - no Redis needed to prove the throttle shape. */
function fakeRateLimiter(max: number): RateLimiter {
  const counts = new Map<string, number>();
  return {
    async check(key: string) {
      const used = (counts.get(key) ?? 0) + 1;
      counts.set(key, used);
      return used <= max ? { allowed: true } : { allowed: false, retryAfterSeconds: 60 };
    },
  };
}

function fakeRouter() {
  return { route: async () => NO_ROUTE };
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

function serviceFor({
  operatorIds = new Set([OLIVE.userId]),
  budget = 10,
}: { operatorIds?: Set<string>; budget?: number } = {}): IdentityLookupService {
  return IdentityLookupService.create({
    reads,
    router: fakeRouter(),
    history: new EmptyIdentityHistory(),
    identity: () => createApiFixture<Pick<IdentityService, "detachIdentifier">>({}),
    links: createApiFixture<IdentityLookupServiceDeps["links"]>({}),
    sessions: createApiFixture<IdentityLookupServiceDeps["sessions"]>({
      listBrowserSessions: async () => [],
    }),
    invitations: createApiFixture<IdentityLookupServiceDeps["invitations"]>({}),
    platformOperators: new FakeOperators(operatorIds),
    auditLog,
    rateLimiter: fakeRateLimiter(budget),
  });
}

beforeEach(() => {
  store = MemoryIdentityStore.create();
  reads = MemoryIdentityLookupRepository.create(store);
  auditLog = new FakeAuditLog(reads);
});

describe("IdentityLookupService", () => {
  describe("when the address nobody holds is resolved", () => {
    /** @scenario "A lookup that finds nobody is recorded exactly like one that finds somebody" */
    it("answers with an empty people list and still records the attempt", async () => {
      const answer = await serviceFor().lookupAddress({
        address: "nobody@acme.com",
        operator: OLIVE,
      });

      expect(answer.people).toEqual([]);
      expect(auditLog.rows).toHaveLength(1);
      expect(auditLog.rows[0]?.userId).toBe(OLIVE.userId);
    });
  });

  describe("when a stranger has no platform operator access", () => {
    /** @scenario "A stranger cannot fill the trail with their own attempts" */
    it("records only up to the shared budget, then refuses without adding to the trail", async () => {
      const service = serviceFor({ operatorIds: new Set(), budget: 2 });

      for (let attempt = 0; attempt < 4; attempt++) {
        await expect(
          service.lookupAddress({ address: "sam@acme.com", operator: MALLORY }),
        ).rejects.toMatchObject({ code: "not_found" });
      }

      expect(auditLog.rows).toHaveLength(2);
    });

    /** @scenario "Without platform operator access the surface is not there at all" */
    it("refuses with nothing about the address, every time", async () => {
      const service = serviceFor({ operatorIds: new Set() });

      await expect(
        service.lookupAddress({ address: "sam@acme.com", operator: MALLORY }),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        service.lookupAddress({ address: "sam@acme.com", operator: MALLORY }),
      ).rejects.toMatchObject({ code: "not_found" });
    });
  });

  describe("when an operator resolves many addresses in quick succession", () => {
    /** @scenario "An operator working a support case is never throttled out of the trail" */
    it("records every one of them, past any stranger's budget", async () => {
      const service = serviceFor({ budget: 2 });

      for (let attempt = 0; attempt < 5; attempt++) {
        await service.lookupAddress({ address: `sam${attempt}@acme.com`, operator: OLIVE });
      }

      expect(auditLog.rows).toHaveLength(5);
    });
  });

  describe("when any lookup is recorded", () => {
    /** @scenario "The recorded address is the address, and the history is not a copy of the person" */
    it("carries the address and the operator, and no secret-shaped field", async () => {
      await serviceFor().lookupAddress({ address: "sam@acme.com", operator: OLIVE });

      const [row] = auditLog.rows;
      expect(row?.userId).toBe(OLIVE.userId);
      expect(row?.args).toMatchObject({ address: "sam@acme.com" });
      expect(JSON.stringify(row)).not.toMatch(/password|token|session/i);
    });
  });

  describe("when an operator opens a person from the lookup", () => {
    /** @scenario "Each person's sign-in methods are listed whatever state they are in" */
    it("lists every identifier the person holds, in every state", async () => {
      store.identifiers.set("id_1", {
        identifierId: "id_1",
        userId: "user_sam",
        provider: "credential",
        value: "sam@acme.com",
        domain: "acme.com",
        identifierHash: null,
        accountId: null,
        providerId: null,
        issuer: null,
        providerAccountId: null,
        connectionId: null,
        state: "DETACHED",
        verifiedAtMs: null,
        attachedAtMs: 1,
        detachedAtMs: 2,
      });
      reads.users.set("user_sam", { userId: "user_sam", name: "Sam", email: "sam@acme.com" });

      const detail = await serviceFor().getLookupPerson({
        userId: "user_sam",
        address: "sam@acme.com",
        operator: OLIVE,
      });

      expect(detail?.identifiers).toHaveLength(1);
      expect(detail?.identifiers[0]?.state).toBe("DETACHED");
    });
  });

  describe("when the operator pastes an address with different capitalization", () => {
    /** @scenario "The address is resolved the way the auth screens resolves it" */
    it("resolves to the same normalized value the auth screens would use", async () => {
      const answer = await serviceFor().lookupAddress({
        address: "Sam+ops@ACME.com",
        operator: OLIVE,
      });

      expect(answer.typed).toBe("Sam+ops@ACME.com");
      expect(answer.resolved).toBe(normalizeIdentifierValue("Sam+ops@ACME.com"));
    });
  });
});
