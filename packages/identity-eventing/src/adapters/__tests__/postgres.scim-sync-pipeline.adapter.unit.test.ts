import { SCIM_TOKEN_REVOKED_EVENT_TYPE } from "@langwatch/identity-contract";
import { createTenantId, type StateProjectionStore } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";
import {
  PostgresScimSyncPipelineAdapter,
  type ScimSyncPipelineDatabase,
} from "../postgres.scim-sync-pipeline.adapter";
import type { ScimSyncFoldState } from "../../scim-sync/projections/scimSyncState.foldProjection";
import type { ScimSyncPipeline } from "../../scim-sync/pipeline";

const ORGANIZATION = "organization_acme";
const SYNC = "scimsync_1";
const CONNECTION = "ssoconn_1";

function recordingDatabase() {
  const findUnique = vi.fn(async () => null);
  const findFirst = vi.fn(async () => null);
  const upsert = vi.fn(async () => undefined);
  const database = {
    scimSyncState: { findUnique, findFirst, upsert },
  } as unknown as ScimSyncPipelineDatabase;
  return { database, findUnique, findFirst, upsert };
}

function compose() {
  const recording = recordingDatabase();
  const pipeline: ScimSyncPipeline = PostgresScimSyncPipelineAdapter.create({
    database: recording.database,
  }).build();
  return { ...recording, pipeline };
}

function syncStore(pipeline: ScimSyncPipeline): StateProjectionStore<ScimSyncFoldState> {
  const projection = pipeline.stateProjections?.get("scimSyncState");
  expect(projection, "the pipeline registered no scimSyncState projection").toBeDefined();
  return projection!.store as StateProjectionStore<ScimSyncFoldState>;
}

function foldedState(): ScimSyncFoldState {
  return {
    scimSyncId: SYNC,
    connectionId: CONNECTION,
    organizationId: ORGANIZATION,
    state: "ACTIVE",
    lastPushedAtMs: 1_700_000_000_000,
    lastFailure: null,
    deadLetters: [],
    revokedCause: null,
    createdAtMs: 1_600_000_000_000,
    updatedAtMs: 1_700_000_000_000,
    CreatedAt: 1_600_000_000_000,
    UpdatedAt: 1_700_000_000_000,
    LastEventOccurredAt: 1_700_000_000_000,
  };
}

describe("PostgresScimSyncPipelineAdapter", () => {
  describe("given a process holding one typed Prisma client", () => {
    /**
     * Frozen twin: `PipelineRegistry.registerAll` builds the same pipeline
     * from `createScimSyncPipeline`, and both graphs route
     * `${pipeline}:${jobType}:${jobName}` off one `event-sourcing/jobs`
     * queue. The names are LITERAL here rather than imported, because the
     * failure this catches is a rename that moved both the constant and its
     * use — the checked-in `apps/worker/src/features/job-registry.json` names
     * exactly these keys, and an unroutable job is redelivered forever rather
     * than dropped.
     */
    /** @scenario "The worker builds the directory-sync ledger from its own client" */
    it("builds the pipeline the legacy registry registers, key for key", () => {
      const { pipeline } = compose();

      expect(pipeline.metadata.name).toBe("scim-sync");
      expect(pipeline.commands.map((command) => command.name)).toEqual([
        "issueScimToken",
        "recordScimUserPush",
        "recordScimGroupMapping",
        "recordScimApplyFailure",
        "revokeScimSync",
      ]);
      expect([...(pipeline.stateProjections?.keys() ?? [])]).toEqual(["scimSyncState"]);
      // No process manager, deliberately: the retry belongs to the directory.
      expect(pipeline.processManagers ?? []).toHaveLength(0);
    });

    /** @scenario "The worker builds the directory-sync ledger from its own client" */
    it("folds a sync's state onto that client's ScimSyncState row", async () => {
      const { pipeline, upsert } = compose();

      await syncStore(pipeline).store(
        {
          state: foldedState(),
          cursor: { acceptedAt: 1_700_000_000_500, eventId: "evt_1" },
          occurredAt: 1_700_000_000_000,
          createdAt: 1_600_000_000_000,
          updatedAt: 1_700_000_000_000,
          version: "1",
        },
        { aggregateId: SYNC, tenantId: createTenantId(ORGANIZATION) },
      );

      expect(upsert).toHaveBeenCalledTimes(1);
      const [request] = upsert.mock.calls[0] as unknown as [
        { where: { id: string }; create: Record<string, unknown> },
      ];
      expect(request.where).toEqual({ id: SYNC });
      expect(request.create).toMatchObject({
        id: SYNC,
        connectionId: CONNECTION,
        organizationId: ORGANIZATION,
        state: "ACTIVE",
        lastEventId: "evt_1",
        // Business time from the events, never `now()` — a replay has to
        // rebuild the identical row.
        createdAt: new Date(1_600_000_000_000),
        updatedAt: new Date(1_700_000_000_000),
      });
    });

    /**
     * The fold's store and the guards' read are ONE repository (D08). Two
     * would still compile and still route every key; what they would
     * eventually disagree about is `deadLetters` — the record of what a
     * directory was told it could stop retrying.
     */
    /** @scenario "One ScimSyncState repository serves the fold and its guards" */
    it("runs the guards' read over the same client the fold writes", async () => {
      const { pipeline, findFirst } = compose();
      const revoke = pipeline.commands.find((command) => command.name === "revokeScimSync");
      expect(
        revoke?.handlerInstance,
        "revokeScimSync was registered without a guard",
      ).toBeDefined();

      const facts = await (
        revoke!.handlerInstance as { handle(command: unknown): Promise<{ type: string }[]> }
      ).handle({
        data: {
          tenantId: ORGANIZATION,
          organizationId: ORGANIZATION,
          scimSyncId: SYNC,
          connectionId: CONNECTION,
          commandId: "cmd_1",
          occurredAtMs: 1_700_000_000_000,
          actor: { type: "system", id: null },
          tokenId: null,
          cause: "teardown",
        },
      });

      expect(facts.map((fact) => fact.type)).toEqual([SCIM_TOKEN_REVOKED_EVENT_TYPE]);
      // Organization-scoped as well as keyed by the sync: a command whose
      // tenant and aggregate disagree must resolve to nothing rather than to
      // another organization's sync.
      expect(findFirst).toHaveBeenCalledWith({
        where: { id: SYNC, organizationId: ORGANIZATION },
      });
    });
  });
});
