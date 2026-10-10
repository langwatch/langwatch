/**
 * @vitest-environment node
 * Identity appends to its own aggregates through each pipeline's own event store.
 * Spec: modules/identity/specs/identity-pipeline-registration-ownership.feature
 */
import {
  type Event,
  type EventStore,
  type EventingParticipation,
  PipelineEventStore,
  type StateProjectionStore,
} from "@langwatch/eventing";
import {
  EXPIRE_JOIN_COMMAND_TYPE,
  JOIN_REQUEST_AGGREGATE_TYPE,
  JOIN_REQUEST_PIPELINE_NAME,
  type JoinRequestCommand,
} from "@langwatch/identity-contract";
import { describe, expect, it, vi } from "vitest";

import { AppendingJoinRequestLedgerStore } from "../../features/join-request/eventing/join-request-appending-ledger.store.ts";
import type { JoinRequestFoldState } from "../../features/join-request/eventing/join-request-state.projection.ts";
import { ConnectedIdentityEventing } from "../identity-command-senders.store.ts";
import { IdentityEventStores } from "../identity-event-stores.store.ts";

const ORGANIZATION = "organization_acme";
const REQUEST = "joinreq_1";
const T0 = 1_700_000_000_000;

type Asked = { tenantId: string; aggregateId: string; aggregateType: string };

/** A pipeline's own store over a recording log, bound to the aggregate it declares. */
function ownStore(input: { pipeline: string; aggregateType: string; events?: Event[] }) {
  const asked: Asked[] = [];
  const stored: { tenantId: string; aggregateType: string; count: number }[] = [];
  const getEvents: EventStore["getEvents"] = async ({ aggregateId, context, aggregateType }) => {
    asked.push({ tenantId: context.tenantId, aggregateId, aggregateType });
    return input.events ?? [];
  };
  const storeEvents: EventStore["storeEvents"] = async (events, context, aggregateType) => {
    stored.push({ tenantId: context.tenantId, aggregateType, count: events.length });
  };
  const eventStore = PipelineEventStore.create({
    pipeline: input.pipeline,
    log: () => ({ getEvents, storeEvents }),
  });
  eventStore.bindTo({ aggregate: { type: input.aggregateType } });
  return { eventStore, asked, stored };
}

/** A fold already past anything appended, so the ledger's convergence returns at once. */
const foldedPastEverything: StateProjectionStore<JoinRequestFoldState> = {
  get: async () => ({
    kind: "folded",
    projection: {
      state: {} as JoinRequestFoldState,
      cursor: { acceptedAt: Number.MAX_SAFE_INTEGER, eventId: "evt_last" },
      occurredAt: 0,
      createdAt: 0,
      updatedAt: 0,
      version: "1",
    },
  }),
  store: async () => {
    throw new Error("the ledger never stores the fold");
  },
};

const expireCommand: JoinRequestCommand = {
  type: EXPIRE_JOIN_COMMAND_TYPE,
  data: {
    tenantId: ORGANIZATION,
    organizationId: ORGANIZATION,
    joinRequestId: REQUEST,
    commandId: "cmd_1",
    occurredAtMs: T0,
    actor: { type: "system", id: "system:join-requests" },
    scheduledFor: T0,
  },
};

/** The join-request ledger as the app composes it: over a held store and connected senders. */
function joinRequestLedger(stores: IdentityEventStores) {
  const send = vi.fn(async () => undefined);
  const commands = ConnectedIdentityEventing.create();
  commands.connect({
    pipeline: JOIN_REQUEST_PIPELINE_NAME,
    commands: Object.fromEntries(
      ["requestJoin", "approveJoin", "rejectJoin", "withdrawJoin", "expireJoin"].map((name) => [
        name,
        { send },
      ]),
    ),
  });
  const ledger = AppendingJoinRequestLedgerStore.forPipeline({
    projectionStore: foldedPastEverything,
    eventStore: stores.of({ pipeline: JOIN_REQUEST_PIPELINE_NAME }),
    commands,
  });
  return { ledger, send };
}

describe("given identity's pipelines are built over their own event stores", () => {
  describe("when the process builds a pipeline", () => {
    it.each<EventingParticipation>(["produce", "consume"])(
      "keeps the store a %s build is handed",
      (participation) => {
        const stores = IdentityEventStores.create();
        const { eventStore } = ownStore({
          pipeline: JOIN_REQUEST_PIPELINE_NAME,
          aggregateType: JOIN_REQUEST_AGGREGATE_TYPE,
        });

        stores.keep({ pipeline: JOIN_REQUEST_PIPELINE_NAME, participation, eventStore });

        expect(stores.holds({ pipeline: JOIN_REQUEST_PIPELINE_NAME })).toBe(true);
      },
    );

    /** @scenario "Identity appends to its own aggregates through each pipeline's own event store" */
    it("keeps nothing from a build only to be listed", () => {
      const stores = IdentityEventStores.create();
      const { eventStore } = ownStore({
        pipeline: JOIN_REQUEST_PIPELINE_NAME,
        aggregateType: JOIN_REQUEST_AGGREGATE_TYPE,
      });

      stores.keep({ pipeline: JOIN_REQUEST_PIPELINE_NAME, participation: "describe", eventStore });

      expect(stores.holds({ pipeline: JOIN_REQUEST_PIPELINE_NAME })).toBe(false);
    });
  });

  describe("when a join-request command states a fact", () => {
    /** @scenario "Identity appends to its own aggregates through each pipeline's own event store" */
    it("appends it through the join_request pipeline's own store, in the organization's tenant", async () => {
      const stores = IdentityEventStores.create();
      const { eventStore, stored } = ownStore({
        pipeline: JOIN_REQUEST_PIPELINE_NAME,
        aggregateType: JOIN_REQUEST_AGGREGATE_TYPE,
      });
      stores.keep({ pipeline: JOIN_REQUEST_PIPELINE_NAME, participation: "consume", eventStore });
      const { ledger, send } = joinRequestLedger(stores);

      await ledger.commit({
        command: expireCommand,
        facts: [{ type: "lw.identity.join_expired", data: {} }] as never,
      });

      expect(stored).toEqual([
        { tenantId: ORGANIZATION, aggregateType: JOIN_REQUEST_AGGREGATE_TYPE, count: 1 },
      ]);
      expect(send).toHaveBeenCalledOnce();
    });

    /** @scenario "A ledger whose pipeline this process never built refuses by name" */
    it("refuses by name, staging nothing, where the process never built the pipeline", async () => {
      const { ledger, send } = joinRequestLedger(IdentityEventStores.create());

      await expect(
        ledger.commit({
          command: expireCommand,
          facts: [{ type: "lw.identity.join_expired", data: {} }] as never,
        }),
      ).rejects.toThrow(/join-requests pipeline cannot append/);
      expect(send).not.toHaveBeenCalled();
    });
  });
});
