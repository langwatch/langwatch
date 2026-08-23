import { describe, expect, it } from "vitest";
import { createTenantId } from "../../..";
import type { Command } from "../../../commands/command";
import {
  AttachIdentifierCommand,
  DetachIdentifierCommand,
  type IdentityGuardReads,
  MarkPrimaryCommand,
  VerifyIdentifierCommand,
} from "../commands/identityCommands";
import {
  type IdentityFoldState,
  IdentityStateFoldProjection,
} from "../projections/identityState.foldProjection";
import type { IdentityLedgerState } from "../projections/reduceIdentity";
import type { IdentityEvent } from "../schemas/events";

const USER = "user_sam";
const ACTOR = { type: "user" as const, id: USER };
const T0 = 1_690_000_000_000;

/**
 * ADR-101 §3: `Identifier` is an ordinary whole-row projection — replay's
 * writes win, and replay must therefore be a pure function of the stream.
 * The whole chain runs twice from the same commands — handlers, wire
 * schemas, the reducer — and the reducer-owned state must come out
 * deep-equal across runs (the base class's wall-clock stamps are server
 * rig, deliberately outside the proof surface).
 */

class ScriptedGuardReads implements IdentityGuardReads {
  state: IdentityLedgerState = { userId: USER, identifiers: {} };

  async getUserHashKey(_params: { userId: string }) {
    return "key_material";
  }

  async findActiveIdentifierByValue(_params: { normalizedValue: string }) {
    return null;
  }

  async loadIdentityState(_params: { userId: string }) {
    return this.state;
  }
}

function command<T>(data: T): Command<T> {
  return {
    tenantId: createTenantId(USER),
    aggregateId: USER,
    type: "lw.identity.test",
    data,
  } as unknown as Command<T>;
}

function fold(events: IdentityEvent[]): IdentityFoldState {
  const projection = new IdentityStateFoldProjection({
    store: { load: async () => null, store: async () => void 0 },
  });
  return events.reduce(
    (state, event) => projection.apply(state, event),
    projection.init(),
  );
}

function reducerSurface(state: IdentityFoldState) {
  const { CreatedAt, UpdatedAt, LastEventOccurredAt, ...surface } = state;
  return surface;
}

async function emitHistory(): Promise<IdentityEvent[]> {
  const reads = new ScriptedGuardReads();
  const events: IdentityEvent[] = [];

  const push = (emitted: IdentityEvent[]) => {
    events.push(...emitted);
    reads.state = reducerSurface(fold(events));
  };

  push(
    await new AttachIdentifierCommand(reads).handle(
      command({
        tenantId: USER,
        userId: USER,
        commandId: "idcmd_a1",
        accountId: "acc_1",
        provider: "google" as const,
        providerAccountId: "gid_123",
        value: "Sam.J@Acme.com",
        occurredAtMs: T0,
        ceremony: { flow: "oauth-callback" },
        actor: ACTOR,
      }),
    ),
  );
  push(
    await new AttachIdentifierCommand(reads).handle(
      command({
        tenantId: USER,
        userId: USER,
        commandId: "idcmd_a2",
        accountId: null,
        provider: "email" as const,
        providerAccountId: null,
        value: "sam@personal.dev",
        occurredAtMs: T0 + 1000,
        ceremony: { flow: "attach-email" },
        actor: ACTOR,
      }),
    ),
  );
  const emailIdentifierId = (events[1]!.data as { identifierId: string })
    .identifierId;
  push(
    await new VerifyIdentifierCommand(reads).handle(
      command({
        tenantId: USER,
        userId: USER,
        commandId: "idcmd_v1",
        identifierId: emailIdentifierId,
        verificationId: "verif_1",
        method: "magic-link" as const,
        occurredAtMs: T0 + 2000,
        actor: ACTOR,
      }),
    ),
  );
  push(
    await new MarkPrimaryCommand(reads).handle(
      command({
        tenantId: USER,
        userId: USER,
        commandId: "idcmd_p1",
        identifierId: emailIdentifierId,
        occurredAtMs: T0 + 3000,
        actor: ACTOR,
      }),
    ),
  );
  const googleIdentifierId = (events[0]!.data as { identifierId: string })
    .identifierId;
  push(
    await new DetachIdentifierCommand(reads).handle(
      command({
        tenantId: USER,
        userId: USER,
        commandId: "idcmd_d1",
        identifierId: googleIdentifierId,
        occurredAtMs: T0 + 4000,
        actor: ACTOR,
      }),
    ),
  );
  return events;
}

describe("identity replay determinism", () => {
  describe("when the same history folds twice from scratch", () => {
    /** @scenario "Replay rebuilds the Identifier projection identically" */
    it("produces identical reducer state, row for row", async () => {
      const firstRun = await emitHistory();
      const secondRun = await emitHistory();

      // The emitted streams themselves converge: deterministic ids, same
      // idempotency keys, same payloads.
      expect(secondRun.map((e) => e.data)).toEqual(firstRun.map((e) => e.data));

      const live = reducerSurface(fold(firstRun));
      const replayed = reducerSurface(fold(firstRun));
      expect(replayed).toEqual(live);

      const facts = Object.values(live.identifiers);
      expect(facts).toHaveLength(2);
      expect(facts.map((f) => f.state).sort()).toEqual(["DETACHED", "PRIMARY"]);
    });
  });
});
