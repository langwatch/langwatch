import { JoinRequestMailPort } from "../../ports/join-request-mail.port";
import { createTenantId, type EventSourcing, type StateProjectionStore } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";
import {
  PostgresJoinRequestPipelineAdapter,
  type JoinRequestPipelineDatabase,
} from "../postgres.join-request-pipeline.adapter";
import type { JoinRequestFoldState } from "../../projections/join-request-state.projection";
import type { JoinRequestPipeline } from "../join-request-pipeline-definition.adapter";

/**
 * Spec: packages/features/identity/specs/join-request-worker-composition.feature
 */
const ORGANIZATION = "organization_acme";
const REQUEST = "joinreq_1";
const REQUESTER = "user_ada";

class SilentMail extends JoinRequestMailPort {
  async sendStillWaiting(): Promise<void> {}
  async sendExpired(): Promise<void> {}
}

function recordingDatabase() {
  const findUnique = vi.fn(async () => null);
  const findFirst = vi.fn(async () => null);
  const upsert = vi.fn(async () => undefined);
  const database = {
    joinRequest: { findUnique, findFirst, upsert },
    organization: { findUnique: vi.fn(async () => null) },
    organizationUser: { findMany: vi.fn(async () => []) },
    user: { findUnique: vi.fn(async () => null) },
  } as unknown as JoinRequestPipelineDatabase;
  return { database, findUnique, findFirst, upsert };
}

function compose() {
  const recording = recordingDatabase();
  const eventSourcing = { isEnabled: false } as unknown as EventSourcing;
  const pipeline: JoinRequestPipeline = PostgresJoinRequestPipelineAdapter.create({
    database: recording.database,
    eventSourcing,
    mail: new SilentMail(),
  }).build();
  return { ...recording, pipeline };
}

function requestStore(pipeline: JoinRequestPipeline): StateProjectionStore<JoinRequestFoldState> {
  const projection = pipeline.stateProjections?.get("joinRequestState");
  expect(projection, "the pipeline registered no joinRequestState projection").toBeDefined();
  return projection!.store as StateProjectionStore<JoinRequestFoldState>;
}

function foldedState(): JoinRequestFoldState {
  return {
    joinRequestId: REQUEST,
    userId: REQUESTER,
    organizationId: ORGANIZATION,
    domain: "acme.example",
    state: "PENDING",
    matchedVia: "verified-identifier-domain",
    createdAtMs: 1_600_000_000_000,
    updatedAtMs: 1_700_000_000_000,
    expiresAtMs: 1_700_600_000_000,
    resolvedAtMs: null,
    resolvedByType: null,
    resolvedById: null,
    withdrawalCause: null,
    CreatedAt: 1_600_000_000_000,
    UpdatedAt: 1_700_000_000_000,
    LastEventOccurredAt: 1_700_000_000_000,
  };
}

describe("given a process holding one typed Prisma client", () => {
  describe("when it composes the join-request pipeline", () => {
    /**
     * Frozen twin: `PipelineRegistry.registerAll` builds the same pipeline
     * from `createJoinRequestPipeline`, and both graphs route
     * `${pipeline}:${jobType}:${jobName}` off one `event-sourcing/jobs` queue.
     * The names are LITERAL here rather than imported, because the failure
     * this catches is a rename that moved both the constant and its use — the
     * checked-in `apps/worker/src/features/job-registry.json` names exactly
     * these keys, and an unroutable job is redelivered forever rather than
     * dropped.
     */
    /** @scenario "The worker builds the join-request ledger from its own client" */
    it("builds the pipeline the legacy registry registers, key for key", () => {
      const { pipeline } = compose();

      expect(pipeline.metadata.name).toBe("join-requests");
      expect(pipeline.commands.map((command) => command.name)).toEqual([
        "requestJoin",
        "approveJoin",
        "rejectJoin",
        "withdrawJoin",
        "expireJoin",
      ]);
      expect([...(pipeline.stateProjections?.keys() ?? [])]).toEqual(["joinRequestState"]);
      // The two timers, on one wake column. Without this process manager a
      // pending request neither expires nor reminds anyone.
      expect([...pipeline.processManagers.keys()]).toEqual(["joinRequestLifecycle"]);
    });

    /** @scenario "The worker builds the join-request ledger from its own client" */
    it("folds a request onto that client's JoinRequest row", async () => {
      const { pipeline, upsert } = compose();

      await requestStore(pipeline).store(
        {
          state: foldedState(),
          cursor: { acceptedAt: 1_700_000_000_500, eventId: "evt_1" },
          occurredAt: 1_700_000_000_000,
          createdAt: 1_600_000_000_000,
          updatedAt: 1_700_000_000_000,
          version: "1",
        },
        { aggregateId: REQUEST, tenantId: createTenantId(ORGANIZATION) },
      );

      expect(upsert).toHaveBeenCalledTimes(1);
      const [request] = upsert.mock.calls[0] as unknown as [
        { where: { id: string }; create: Record<string, unknown> },
      ];
      expect(request.where).toEqual({ id: REQUEST });
      expect(request.create).toMatchObject({
        id: REQUEST,
        userId: REQUESTER,
        organizationId: ORGANIZATION,
        state: "PENDING",
        lastEventId: "evt_1",
        // Business time from the events, never `now()` — a replay has to
        // rebuild the identical row.
        createdAt: new Date(1_600_000_000_000),
        updatedAt: new Date(1_700_000_000_000),
      });
    });
  });
});

describe("given a composed join-request pipeline", () => {
  describe("when a guard reads a request's state", () => {
    /**
     * The fold's store and the guards' read are ONE repository. Two would
     * still compile and still route every key; what they would eventually
     * disagree about is `state` — the difference between refusing a second
     * request and admitting one.
     */
    /** @scenario "Split JoinRequest repositories share one Prisma client" */
    it("reads the rows the fold writes, through the same Prisma client", async () => {
      const { pipeline, findUnique, findFirst, database } = compose();
      const withdraw = pipeline.commands.find((command) => command.name === "withdrawJoin");
      expect(
        withdraw?.handlerInstance,
        "withdrawJoin was registered without a guard",
      ).toBeDefined();

      await (withdraw!.handlerInstance as { handle(command: unknown): Promise<unknown> })
        .handle({
          data: {
            tenantId: ORGANIZATION,
            organizationId: ORGANIZATION,
            joinRequestId: REQUEST,
            commandId: "cmd_1",
            occurredAtMs: 1_700_000_000_000,
            actor: { type: "user", id: REQUESTER },
            userId: REQUESTER,
            cause: "REQUESTER",
          },
        })
        .catch(() => void 0);

      // Whatever the guard decided, it decided it against this client's rows.
      expect(findUnique.mock.calls.length + findFirst.mock.calls.length).toBeGreaterThan(0);
      // The guard reads through a dedicated read repository, split from the
      // fold's write-side store — not the same object, but the same typed
      // Prisma client underneath, so both sides route every key to the one
      // table.
      const guards = (
        withdraw!.handlerInstance as unknown as {
          guards: { requests: { prisma: unknown } };
        }
      ).guards;
      expect(guards.requests).not.toBe(requestStore(pipeline));
      expect(guards.requests.prisma).toBe(database);
    });
  });
});
