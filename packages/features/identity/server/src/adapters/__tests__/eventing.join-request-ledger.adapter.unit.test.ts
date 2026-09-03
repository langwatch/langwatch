import {
  APPROVE_JOIN_COMMAND_TYPE,
  EXPIRE_JOIN_COMMAND_TYPE,
  type JoinRequestCommand,
} from "@langwatch/identity-contract";
import type { EventStore, StateProjectionStore } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";
import {
  EventingJoinRequestLedgerAdapter,
  type JoinRequestStagedSender,
} from "../eventing.join-request-ledger.adapter";
import type { JoinRequestEvent } from "../join-request-pipeline-definition.adapter";
import type { JoinRequestFoldState } from "../../projections/join-request-state.projection";

/**
 * Spec: packages/features/identity/specs/join-request-worker-composition.feature
 */
const ORGANIZATION = "organization_acme";
const REQUEST = "joinreq_1";

function compose(input: { senders?: Record<string, JoinRequestStagedSender> } = {}) {
  const storeEvents = vi.fn(async () => undefined);
  const send = vi.fn(async () => undefined);
  const senders = input.senders ?? { expireJoin: { send }, approveJoin: { send } };
  const tryResolveStagedSender = vi.fn((name: string) => senders[name] ?? null);
  // A store whose cursor already sits past anything appended, so convergence
  // returns on the first read rather than sleeping through a real window.
  const tryLoad = vi.fn(async () => ({
    state: {} as JoinRequestFoldState,
    cursor: { acceptedAt: Number.MAX_SAFE_INTEGER, eventId: "evt_last" },
    occurredAt: 0,
    createdAt: 0,
    updatedAt: 0,
    version: "1",
  }));

  const adapter = EventingJoinRequestLedgerAdapter.create({
    projectionStore: { tryLoad } as unknown as StateProjectionStore<JoinRequestFoldState>,
    eventStore: async () => ({ storeEvents }) as unknown as EventStore<JoinRequestEvent>,
    tryResolveStagedSender,
    convergence: { timeoutMs: 20, pollMs: 1 },
  });
  return { adapter, storeEvents, send, tryResolveStagedSender, tryLoad };
}

const expireCommand = (): JoinRequestCommand =>
  ({
    type: EXPIRE_JOIN_COMMAND_TYPE,
    data: {
      tenantId: ORGANIZATION,
      organizationId: ORGANIZATION,
      joinRequestId: REQUEST,
      commandId: "cmd_1",
      occurredAtMs: 1_700_000_000_000,
      actor: { type: "system", id: "system:join-requests" },
      scheduledFor: 1_700_000_000_000,
    },
  }) as unknown as JoinRequestCommand;

describe("given a command whose guard stated a fact", () => {
  describe("when the ledger commits it", () => {
    /** @scenario "The expiry wake dispatches a command rather than writing the row" */
    it("appends the fact, then stages the command under the pipeline's own name", async () => {
      const { adapter, storeEvents, send, tryResolveStagedSender } = compose();

      const facts = await adapter.commit({
        command: expireCommand(),
        facts: [{ type: "lw.identity.join_expired", data: {} }] as never,
      });

      expect(storeEvents).toHaveBeenCalledOnce();
      // The sender is resolved by NAME, which is the only thing tying a
      // command type to a lane the pipeline actually registered.
      expect(tryResolveStagedSender).toHaveBeenCalledWith("expireJoin");
      expect(send).toHaveBeenCalledOnce();
      expect(facts).toHaveLength(1);
    });

    /** @scenario "The expiry wake dispatches a command rather than writing the row" */
    it("refuses loudly when the pipeline exposes no lane for the command", async () => {
      const { adapter, storeEvents } = compose({ senders: {} });

      // A wiring defect, not a transient: the pipeline declares this command
      // type and exposed no sender for it, so nothing downstream folds.
      await expect(
        adapter.commit({
          command: expireCommand(),
          facts: [{ type: "lw.identity.join_expired", data: {} }] as never,
        }),
      ).rejects.toThrow(/exposes no "expireJoin" sender/);
      expect(storeEvents).toHaveBeenCalledOnce();
    });
  });
});

describe("given a command whose guard stated nothing", () => {
  describe("when the ledger commits it", () => {
    /** @scenario "The expiry wake dispatches a command rather than writing the row" */
    it("appends nothing and stages nothing", async () => {
      const { adapter, storeEvents, send } = compose();

      const facts = await adapter.commit({
        command: { ...expireCommand(), type: APPROVE_JOIN_COMMAND_TYPE } as JoinRequestCommand,
        facts: [],
      });

      expect(facts).toEqual([]);
      expect(storeEvents).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });
  });
});
