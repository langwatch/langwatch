import {
  createTenantId,
  EventSourcing,
  type ProjectionStoreContext,
  type StateProjectionStore,
  type StoredProjection,
  type StoredProjectionRead,
} from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import {
  emptyIdentityHeads,
  IdentityIdentifierNotFoundError,
  USER_IDENTITY_AGGREGATE_TYPE,
} from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import type { IdentityFoldState } from "../eventing/identity-state.projection.ts";
import { defineIdentityPipeline } from "../eventing/user-identity.pipeline.ts";
import type { IdentityHeadsRepository } from "../repositories/identity-heads.repository.ts";
import { MemoryIdentityHistoryRepository } from "../repositories/memory/memory.identity-history.repository.ts";
import { MemoryIdentityStore } from "../repositories/memory/memory.identity.store.ts";
import { CryptoIdentifierIdentityService } from "../services/crypto-identifier-identity.service.ts";
import { IdentityGuardsService } from "../services/identity-guards.service.ts";
import { LinkProposalGuardsService } from "../services/link-proposal-guards.service.ts";
import { inMemoryIdentityReservations, inMemoryIdentityUsers } from "../testing.ts";

const USER = "user_sam";
const ACTOR = { type: "user" as const, id: USER };
const T0 = 1_690_000_000_000;

class InMemoryStateStore implements StateProjectionStore<IdentityFoldState> {
  readonly stored = new Map<string, StoredProjection<IdentityFoldState>>();

  async get(
    key: string,
    _context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<IdentityFoldState>> {
    const folded = this.stored.get(key) ?? null;
    return folded === null ? { kind: "empty" } : { kind: "folded", projection: folded };
  }

  async store(
    projection: StoredProjection<IdentityFoldState>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    this.stored.set(context.aggregateId, projection);
  }
}

/** Heads read straight off the in-memory projection store — the app's
 *  Prisma heads repository over the same rows, in one class. */
class ProjectionHeads implements IdentityHeadsRepository {
  constructor(private readonly store: InMemoryStateStore) {}

  async getUserHashKey() {
    return { userHashKey: "key_material" };
  }

  /** Folded: these doubles hold no provisional newborn rows. */
  async hasFolded() {
    return true;
  }

  async getActiveIdentifierByValue(): Promise<{ userId: string; identifierId: string }> {
    throw new IdentityIdentifierNotFoundError("nobody holds it");
  }

  async findHeads({ userId }: { userId: string }) {
    const stored = this.store.stored.get(userId);
    if (!stored) return emptyIdentityHeads({ userId });
    return { userId, identifiers: stored.state.identifiers };
  }

  async getIdentifier({ userId, identifierId }: { userId: string; identifierId: string }) {
    const fact = this.store.stored.get(userId)?.state.identifiers[identifierId];
    if (!fact)
      throw new IdentityIdentifierNotFoundError(`${userId} holds no identifier ${identifierId}`);
    return fact;
  }

  async getIdentifierIdForAccount(): Promise<string> {
    throw new IdentityIdentifierNotFoundError("no identifier mirrors it");
  }
}

async function until<T>(
  read: () => T | undefined,
  { timeoutMs = 5000, intervalMs = 25 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) {
      throw new Error("condition not reached before timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe("identity pipeline", () => {
  describe("when an attach command is dispatched through the framework", () => {
    /** @scenario "An identity command round-trips the whole pipeline" */
    it("appends under the user tenant, folds into the projection, and advances the cursor", async () => {
      const eventSourcing = new EventSourcing({ eventStore: EventStoreMemory.createForTesting() });
      const store = new InMemoryStateStore();
      const pipeline = eventSourcing.register(
        defineIdentityPipeline({
          identityProjectionStore: store,
          identityGuards: IdentityGuardsService.create({
            heads: new ProjectionHeads(store),
            users: inMemoryIdentityUsers(),
            reservations: inMemoryIdentityReservations(),
            identifiers: CryptoIdentifierIdentityService.create(),
          }),
          linkProposalGuards: LinkProposalGuardsService.create({
            proposals: MemoryIdentityHistoryRepository.create(MemoryIdentityStore.create()),
          }),
          // Two-step verification rides this same pipeline (D06); this test
          // exercises the identifier half, so its store is never reached.
          mfaProjectionStore: new InMemoryStateStore() as never,
          mfaGuards: null as never,
        }),
      );
      try {
        await pipeline.service.waitUntilReady();
        const attachIdentifier = pipeline.commands.attachIdentifier;
        if (!attachIdentifier)
          throw new Error("identity pipeline did not install attachIdentifier");
        await attachIdentifier.send({
          tenantId: USER,
          userId: USER,
          commandId: "idcmd_rt1",
          accountId: "acc_1",
          provider: "google",
          providerId: "google",
          issuer: "https://accounts.google.com",
          providerAccountId: "gid_123",
          value: "Sam.J+x@Acme.com",
          occurredAtMs: T0,
          ceremony: { flow: "oauth-callback" },
          actor: ACTOR,
        });

        const projection = await until(() => store.stored.get(USER));
        const facts = Object.values(projection.state.identifiers);
        expect(facts).toHaveLength(1);
        expect(facts[0]!.userId).toBe(USER);
        expect(facts[0]!.value).toBe("sam.j+x@acme.com");
        expect(facts[0]!.state).toBe("VERIFIED");
        // The cursor is the commit marker: it names the applied event.
        expect(projection.cursor.eventId).not.toBe("");
        expect(projection.cursor.acceptedAt).toBeGreaterThan(0);

        const eventStore = eventSourcing.getEventStore();
        expect(eventStore).toBeDefined();
        const appended = await eventStore!.getEvents(
          USER,
          { tenantId: createTenantId(USER) },
          USER_IDENTITY_AGGREGATE_TYPE,
        );
        expect(appended).toHaveLength(1);
        expect(String(appended[0]!.tenantId)).toBe(USER);
      } finally {
        await eventSourcing.close();
      }
    });
  });
});
