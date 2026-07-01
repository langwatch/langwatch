/**
 * Regression test for issue #5124 — evaluation runs emit no billable events.
 *
 * The billable-events meter (orgBillableEventsMeterProjection) used to subscribe
 * to `lw.evaluation.scheduled` / `lw.evaluation.started`, neither of which is ever
 * produced in production. The real evaluation event is `lw.evaluation.reported`
 * (emitted by reportEvaluation / ReportEvaluationCommand / ExecuteEvaluationCommand),
 * so evaluations contributed ZERO billable rows.
 *
 * This drives the actual runtime path — the ProjectionRouter's eventType filter
 * (the bug site) + the real projection `map()` + a capturing store — and asserts a
 * billable record is produced. It is NOT a shape assertion on the eventTypes array:
 * if `reported` is dropped from the subscription, the router filters the event out
 * and the store is never called, failing the test.
 */

import { describe, expect, it, vi } from "vitest";
import type { Event } from "../../../domain/types";
import { EVALUATION_EVENT_TYPES } from "../../../pipelines/evaluation-processing/schemas/constants";
import {
  createMockAppendStore,
  createMockQueueManager,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../../services/__tests__/testHelpers";
import { ProjectionRouter } from "../../projectionRouter";
import { orgBillableEventsMeterProjection } from "../orgBillableEventsMeter.mapProjection";
import type { BillableEventRecord } from "../orgBillableEventsMeter.store";

/**
 * Registers the REAL meter projection (its real eventTypes + real map) onto an
 * inline router, swapping only the store boundary for a capturing spy.
 */
function createMeterRouterWithSpyStore() {
  const appendSpy = vi.fn().mockResolvedValue(void 0);
  const router = new ProjectionRouter(
    TEST_CONSTANTS.AGGREGATE_TYPE,
    TEST_CONSTANTS.PIPELINE_NAME,
    createMockQueueManager(),
  );
  router.registerMapProjection({
    ...orgBillableEventsMeterProjection,
    store: {
      ...createMockAppendStore<BillableEventRecord>(),
      append: appendSpy,
    },
  });
  return { router, appendSpy };
}

/**
 * Builds a `lw.evaluation.reported` event with the production idempotencyKey
 * (`${tenantId}:${evaluationId}:reported`, per ReportEvaluationCommand).
 */
function createReportedEvent(
  tenantId: ReturnType<typeof createTestTenantId>,
  evaluationId: string,
): Event {
  return {
    ...createTestEvent(
      evaluationId,
      TEST_CONSTANTS.AGGREGATE_TYPE,
      tenantId,
      EVALUATION_EVENT_TYPES.REPORTED,
    ),
    idempotencyKey: `${tenantId}:${evaluationId}:reported`,
  };
}

describe("orgBillableEventsMeter — evaluation billing (issue #5124)", () => {
  describe("given the real meter projection registered on a router", () => {
    describe("when an evaluation reported event is dispatched", () => {
      it("records exactly one billable row keyed on the evaluation", async () => {
        const tenantId = createTestTenantId();
        const evaluationId = "eval-abc";
        const { router, appendSpy } = createMeterRouterWithSpyStore();

        await router.dispatch([createReportedEvent(tenantId, evaluationId)], {
          tenantId,
        });

        expect(appendSpy).toHaveBeenCalledTimes(1);
        const record = appendSpy.mock.calls[0]![0] as BillableEventRecord;
        expect(record).toEqual(
          expect.objectContaining({
            tenantId: String(tenantId),
            eventType: EVALUATION_EVENT_TYPES.REPORTED,
            deduplicationKey: `${tenantId}:${evaluationId}:reported`,
          }),
        );
      });
    });

    describe("when the same evaluation is reported twice (retry/replay)", () => {
      it("produces the same dedup key so it collapses to one billable unit", async () => {
        const tenantId = createTestTenantId();
        const evaluationId = "eval-retry";
        const { router, appendSpy } = createMeterRouterWithSpyStore();

        await router.dispatch(
          [
            createReportedEvent(tenantId, evaluationId),
            createReportedEvent(tenantId, evaluationId),
          ],
          { tenantId },
        );

        expect(appendSpy).toHaveBeenCalledTimes(2);
        const keys = appendSpy.mock.calls.map(
          (call) => (call[0] as BillableEventRecord).deduplicationKey,
        );
        expect(new Set(keys).size).toBe(1);
        expect(keys[0]).toBe(`${tenantId}:${evaluationId}:reported`);
      });
    });

    describe("when never-emitted evaluation event types are dispatched", () => {
      it("ignores lw.evaluation.scheduled and lw.evaluation.started since production never emits them", async () => {
        const tenantId = createTestTenantId();
        const { router, appendSpy } = createMeterRouterWithSpyStore();

        await router.dispatch(
          [
            createTestEvent(
              "eval-1",
              TEST_CONSTANTS.AGGREGATE_TYPE,
              tenantId,
              EVALUATION_EVENT_TYPES.SCHEDULED,
            ),
            createTestEvent(
              "eval-2",
              TEST_CONSTANTS.AGGREGATE_TYPE,
              tenantId,
              EVALUATION_EVENT_TYPES.STARTED,
            ),
          ],
          { tenantId },
        );

        expect(appendSpy).not.toHaveBeenCalled();
      });
    });
  });
});
