import { emptyIdentityHeads } from "@langwatch/identity";
import {
  IdentityGuards,
  type IdentityHeadsRepository,
} from "@langwatch/identity-server";
import { describe, expect, it } from "vitest";
import {
  inMemoryIdentityReservations,
  inMemoryIdentityUsers,
} from "~/server/app-layer/identity/__tests__/support/identity-test-doubles";
import { createTenantId } from "../../..";
import { EventSourcing } from "../../../eventSourcing";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import type {
  StateProjectionStore,
  StoredProjection,
} from "../../../projections/stateProjection.types";
import { createIdentityPipeline } from "../pipeline";
import type { IdentityFoldState } from "../projections/identityState.foldProjection";
import { USER_IDENTITY_AGGREGATE_TYPE } from "../schemas/constants";

const USER = "user_sam";
const ACTOR = { type: "user" as const, id: USER };
const T0 = 1_690_000_000_000;

class InMemoryStateStore implements StateProjectionStore<IdentityFoldState> {
  readonly stored = new Map<string, StoredProjection<IdentityFoldState>>();

  async load(
    key: string,
    _context: ProjectionStoreContext,
  ): Promise<StoredProjection<IdentityFoldState> | null> {
    return this.stored.get(key) ?? null;
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

  async findUserHashKey() {
    return "key_material";
  }

  async findActiveIdentifierByValue() {
    return null;
  }

  async findHeads({ userId }: { userId: string }) {
    const stored = this.store.stored.get(userId);
    if (!stored) return emptyIdentityHeads({ userId });
    return { userId, identifiers: stored.state.identifiers };
  }

  async findIdentifier({
    userId,
    identifierId,
  }: {
    userId: string;
    identifierId: string;
  }) {
    return (
      this.store.stored.get(userId)?.state.identifiers[identifierId] ?? null
    );
  }

  async findIdentifierIdForAccount() {
    return null;
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
      const eventSourcing = new EventSourcing();
      const store = new InMemoryStateStore();
      const pipeline = eventSourcing.register(
        createIdentityPipeline({
          identityProjectionStore: store,
          identityGuards: new IdentityGuards(
            new ProjectionHeads(store),
            inMemoryIdentityUsers(),
            inMemoryIdentityReservations(),
          ),
          // Two-step verification rides this same pipeline (D06); this test
          // exercises the identifier half, so its store is never reached.
          mfaProjectionStore: new InMemoryStateStore() as never,
          mfaGuards: null as never,
          // Deciding a waiting sign-in rides this pipeline too (D05); this
          // test attaches an identifier, so the proposal log is never read.
          linkProposalGuards: null as never,
        }),
      );
      try {
        await pipeline.service.waitUntilReady();
        await pipeline.commands.attachIdentifier.send({
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
