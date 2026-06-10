/**
 * @vitest-environment node
 *
 * Integration tests for PgOutboxAuditAdapter — exercises the
 * postgres-specific CAS lifecycle that an in-memory fake cannot model:
 *   - settle INSERT → cadence UPDATE → settle onDispatched no-op
 *   - cadence onEnqueue fallback INSERT when no settle row exists
 *   - stale-attempt onFailed no-op
 *   - stale onLeased no-op once the row is terminal
 */
import { generate } from "@langwatch/ksuid";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { KSUID_RESOURCES } from "../../../../utils/constants";
import { getTestProject } from "../../../../utils/testUtils";
import { prisma } from "../../../db";
import {
  auditDedupKey,
  cadenceGroupKey,
  settleGroupKey,
  TRIGGER_NOTIFY_REACTOR_NAME,
  type CadenceStagePayload,
  type SettleStagePayload,
} from "../payload";
import { PgOutboxAuditAdapter } from "../pgAuditAdapter";

const reactorName = TRIGGER_NOTIFY_REACTOR_NAME;
const triggerId = `test-trigger-${generate(KSUID_RESOURCES.PROJECT)}`;
const traceId = "trace-1";

describe("PgOutboxAuditAdapter", () => {
  const adapter = new PgOutboxAuditAdapter(prisma);
  let projectId: string;
  let dedupKey: string;
  let settlePayload: SettleStagePayload;
  let cadencePayload: CadenceStagePayload;

  beforeAll(async () => {
    const project = await getTestProject("reactor-outbox-audit");
    projectId = project.id;
    dedupKey = auditDedupKey({ projectId, triggerId, traceId });
    settlePayload = {
      stage: "settle",
      projectId,
      triggerId,
      traceId,
      reactorName,
      auditDedupKey: dedupKey,
      foldSnapshotAtEnqueue: { computedInput: "in", computedOutput: "out" },
    };
    cadencePayload = {
      stage: "cadence",
      projectId,
      triggerId,
      reactorName,
      auditDedupKey: dedupKey,
      match: { traceId, input: "in", output: "out" },
    };
  });

  afterEach(async () => {
    await prisma.reactorOutbox.deleteMany({
      where: { projectId, reactorName },
    });
  });

  afterAll(async () => {
    // Project / team / org are reused fixtures — don't delete them.
    await prisma.reactorOutbox.deleteMany({
      where: { projectId, reactorName },
    });
  });

  const findRow = () =>
    prisma.reactorOutbox.findFirst({
      where: { projectId, reactorName, dedupKey },
    });

  const enqueueSettle = () =>
    adapter.onEnqueue({
      payload: settlePayload,
      groupKey: settleGroupKey({ projectId, triggerId, traceId }),
      dedupKey: undefined,
      scheduledAt: new Date(),
    });

  const enqueueCadence = (scheduledAt = new Date(Date.now() + 60_000)) =>
    adapter.onEnqueue({
      payload: cadencePayload,
      groupKey: cadenceGroupKey({ projectId, triggerId }),
      dedupKey: undefined,
      scheduledAt,
    });

  describe("given a settle row that matched and re-enqueued as cadence", () => {
    describe("when settle's onDispatched fires after cadence's onEnqueue", () => {
      it("no-ops so the row stays queued for the cadence stage", async () => {
        await enqueueSettle();
        await adapter.onLeased({ payload: settlePayload, attempt: 1 });

        const cadenceBoundary = new Date(Date.now() + 60_000);
        await enqueueCadence(cadenceBoundary);

        // Settle's terminal hook fires last; the CAS WHERE
        // status='dispatching' no longer matches the re-queued row.
        await adapter.onDispatched({
          payload: settlePayload,
          at: new Date(),
          attempt: 1,
        });

        const row = await findRow();
        expect(row?.status).toBe("queued");
        expect(row?.attempts).toBe(0);
        expect(row?.lastError).toBeNull();
        expect(row?.nextAttemptAt?.getTime()).toBe(cadenceBoundary.getTime());
      });
    });

    describe("when the cadence stage dispatches", () => {
      it("marks the shared row dispatched", async () => {
        await enqueueSettle();
        await adapter.onLeased({ payload: settlePayload, attempt: 1 });
        await enqueueCadence();
        await adapter.onLeased({ payload: cadencePayload, attempt: 1 });

        await adapter.onDispatched({
          payload: cadencePayload,
          at: new Date(),
          attempt: 1,
        });

        const row = await findRow();
        expect(row?.status).toBe("dispatched");
        expect(row?.dispatchedAt).not.toBeNull();
      });
    });
  });

  describe("given no settle row exists", () => {
    describe("when cadence's onEnqueue finds nothing to update", () => {
      it("falls back to inserting a fresh queued row", async () => {
        await enqueueCadence();

        const row = await findRow();
        expect(row?.status).toBe("queued");
        expect(row?.attempts).toBe(0);
      });
    });
  });

  describe("given a row re-leased to a newer attempt", () => {
    describe("when a stale attempt reports onFailed", () => {
      it("no-ops instead of clobbering the live attempt's state", async () => {
        await enqueueSettle();
        // Newer attempt holds the lease.
        await adapter.onLeased({ payload: settlePayload, attempt: 2 });

        // Stale attempt 1 reports back after its lease expired.
        await adapter.onFailed({
          payload: settlePayload,
          error: "stale failure",
          willRetry: true,
          nextAttemptAt: new Date(Date.now() + 1_000),
          attempt: 1,
        });

        const row = await findRow();
        expect(row?.status).toBe("dispatching");
        expect(row?.attempts).toBe(2);
        expect(row?.lastError).toBeNull();
      });
    });
  });

  describe("given a row already dispatched", () => {
    describe("when a late onLeased replays", () => {
      it("no-ops instead of flipping the row back to dispatching", async () => {
        await enqueueSettle();
        await adapter.onLeased({ payload: settlePayload, attempt: 1 });
        await adapter.onDispatched({
          payload: settlePayload,
          at: new Date(),
          attempt: 1,
        });

        await adapter.onLeased({ payload: settlePayload, attempt: 1 });

        const row = await findRow();
        expect(row?.status).toBe("dispatched");
      });
    });
  });
});
