/**
 * The join-request ledger writer, which had no test of its own at all.
 *
 * What is pinned here is the ADR-110 shape: the staged command is the SOLE
 * appender, so this writer touches no event log — and a process that never
 * registered the pipeline is told, rather than being allowed to answer
 * "your request is in" over a command nothing received.
 */
import {
  APPROVE_JOIN_COMMAND_TYPE,
  JOIN_APPROVED_EVENT_TYPE,
  JOIN_REQUESTED_EVENT_TYPE,
  REQUEST_JOIN_COMMAND_TYPE,
  type JoinRequestCommand,
  type JoinRequestFactInput,
} from "@langwatch/identity-contract";
import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
} from "@langwatch/eventing";
import type { JoinRequestFoldState } from "@langwatch/identity-eventing";
import { describe, expect, it, vi } from "vitest";
import { IdentityEventingPort } from "../../ports/identity-eventing.port";
import { JoinRequestLedgerWriter } from "../join-request-ledger.adapter";

const ORGANIZATION = "org_acme";
const REQUEST = "jr_1";
const USER = "user_sam";
const ACTOR = { type: "user" as const, id: USER };
const T0 = 1_690_000_000_000;

/**
 * The projection head as the queue's fold leaves it. `tryLoad` is what the
 * read-your-writes wait watches, so a store that answers `null` forever is a
 * fold that never ran.
 */
class ConvergedProjection implements StateProjectionStore<JoinRequestFoldState> {
  constructor(private readonly converged: boolean) {}
  readonly reads: string[] = [];

  async tryLoad(
    key: string,
    _context: ProjectionStoreContext,
  ): Promise<StoredProjection<JoinRequestFoldState> | null> {
    this.reads.push(key);
    if (!this.converged) return null;
    return {
      state: {} as JoinRequestFoldState,
      // Far past any event this suite states, so the wait returns on its
      // first read rather than spending the window.
      cursor: { acceptedAt: Number.MAX_SAFE_INTEGER, eventId: "zzz" },
      occurredAt: T0,
      createdAt: T0,
      updatedAt: T0,
      version: "1",
    };
  }

  async store(): Promise<void> {
    throw new Error("the ledger wrote a projection, which is the queue's work");
  }
}

/**
 * The process's event stack. `tryEventStore` is deliberately absent from the
 * port now; what remains is the command handle, and this records what the
 * ledger asked for.
 */
class RecordingEventing extends IdentityEventingPort {
  readonly asked: Array<{ pipeline: string; command: string }> = [];
  readonly staged: unknown[] = [];

  constructor(private readonly registered: boolean) {
    super();
  }

  async tryPipelineCommand(input: { pipeline: string; command: string }) {
    this.asked.push(input);
    if (!this.registered) return null;
    return {
      send: async (data: unknown) => {
        this.staged.push(data);
        return undefined;
      },
    };
  }
}

function requestJoin(): { command: JoinRequestCommand; facts: JoinRequestFactInput[] } {
  const data = {
    tenantId: ORGANIZATION,
    organizationId: ORGANIZATION,
    joinRequestId: REQUEST,
    commandId: "cmd_1",
    occurredAtMs: T0,
    actor: ACTOR,
    userId: USER,
    domain: "acme.test",
    matchedVia: "verified-identifier-domain" as const,
    expiresAtMs: T0 + 1_000,
  };
  return {
    command: { type: REQUEST_JOIN_COMMAND_TYPE, data },
    facts: [
      {
        type: JOIN_REQUESTED_EVENT_TYPE,
        data: {
          joinRequestId: REQUEST,
          userId: USER,
          organizationId: ORGANIZATION,
          domain: "acme.test",
          matchedVia: "verified-identifier-domain",
          expiresAtMs: T0 + 1_000,
          actor: ACTOR,
        },
      },
    ],
  };
}

function approveJoin(): { command: JoinRequestCommand; facts: JoinRequestFactInput[] } {
  const data = {
    tenantId: ORGANIZATION,
    organizationId: ORGANIZATION,
    joinRequestId: REQUEST,
    commandId: "cmd_2",
    occurredAtMs: T0,
    actor: ACTOR,
    resolvedBy: { type: "user" as const, id: "user_admin" },
  };
  return {
    command: { type: APPROVE_JOIN_COMMAND_TYPE, data },
    facts: [
      {
        type: JOIN_APPROVED_EVENT_TYPE,
        data: {
          joinRequestId: REQUEST,
          resolvedBy: { type: "user" as const, id: "user_admin" },
          actor: ACTOR,
        },
      },
    ],
  };
}

describe("given a join-request ledger over a registered pipeline", () => {
  describe("when a command states facts", () => {
    it("stages the command on the pipeline's own sender and answers the events", async () => {
      const eventing = new RecordingEventing(true);
      const writer = new JoinRequestLedgerWriter({
        projectionStore: new ConvergedProjection(true),
        eventing,
      });
      const { command, facts } = requestJoin();

      const events = await writer.commit({ command, facts });

      expect(eventing.asked).toEqual([{ pipeline: "join-requests", command: "requestJoin" }]);
      expect(eventing.staged).toEqual([command.data]);
      expect(events.map((event) => event.type)).toEqual([JOIN_REQUESTED_EVENT_TYPE]);
      // The idempotency key the queued re-run derives from the same commandId,
      // which is what makes a retried request cost no second row.
      expect(events[0]).toMatchObject({ aggregateId: REQUEST });
    });

    it("resolves the sender by the verb the command names, not by the pipeline alone", async () => {
      const eventing = new RecordingEventing(true);
      const writer = new JoinRequestLedgerWriter({
        projectionStore: new ConvergedProjection(true),
        eventing,
      });
      const { command, facts } = approveJoin();

      await writer.commit({ command, facts });

      expect(eventing.asked).toEqual([{ pipeline: "join-requests", command: "approveJoin" }]);
    });
  });

  describe("when the guard stated nothing", () => {
    it("stages nothing at all, because there is no fact to carry", async () => {
      const eventing = new RecordingEventing(true);
      const writer = new JoinRequestLedgerWriter({
        projectionStore: new ConvergedProjection(true),
        eventing,
      });
      const { command } = requestJoin();

      const events = await writer.commit({ command, facts: [] });

      expect(events).toEqual([]);
      expect(eventing.asked).toEqual([]);
      expect(eventing.staged).toEqual([]);
    });
  });

  describe("when the projection has not caught up inside the window", () => {
    it("returns the events anyway, because the command is queued and the fold converges", async () => {
      const projection = new ConvergedProjection(false);
      const eventing = new RecordingEventing(true);
      const writer = new JoinRequestLedgerWriter({
        projectionStore: projection,
        eventing,
        convergence: { timeoutMs: 5, pollMs: 1 },
      });
      const { command, facts } = requestJoin();

      const events = await writer.commit({ command, facts });

      expect(events).toHaveLength(1);
      expect(eventing.staged).toEqual([command.data]);
      expect(projection.reads.length).toBeGreaterThan(0);
    });
  });
});

describe("given a process that registered no join-request pipeline", () => {
  describe("when somebody asks to join", () => {
    it("refuses by naming the sender rather than reporting the request as recorded", async () => {
      const eventing = new RecordingEventing(false);
      const writer = new JoinRequestLedgerWriter({
        projectionStore: new ConvergedProjection(true),
        eventing,
      });
      const { command, facts } = requestJoin();

      await expect(writer.commit({ command, facts })).rejects.toThrow(
        /the pipeline exposes no "requestJoin" sender/,
      );
      expect(eventing.staged).toEqual([]);
    });

    it("does not wait on the projection for a command nothing received", async () => {
      const projection = new ConvergedProjection(false);
      const tryLoad = vi.spyOn(projection, "tryLoad");
      const writer = new JoinRequestLedgerWriter({
        projectionStore: projection,
        eventing: new RecordingEventing(false),
      });
      const { command, facts } = requestJoin();

      await expect(writer.commit({ command, facts })).rejects.toThrow();

      expect(tryLoad).not.toHaveBeenCalled();
    });
  });
});
