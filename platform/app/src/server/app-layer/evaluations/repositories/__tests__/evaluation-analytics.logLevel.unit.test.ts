/**
 * @vitest-environment node
 *
 * A write this repository rethrows is not its outcome to claim.
 *
 * The queue above it retries, and on 2026-08-17 three overnight pages turned
 * out to describe writes that all eventually landed. The record still earns
 * its place — it carries `tenantId` and `evaluationId`, which the queue never
 * sees — but at warning, not error.
 *
 * Spec: specs/observability/retryable-failure-log-level.feature
 */
import { describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => logger,
}));

const { EvaluationAnalyticsClickHouseRepository } = await import(
  "../evaluation-analytics.clickhouse.repository"
);
const { EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST } = await import(
  "~/server/event-sourcing/pipelines/evaluation-processing/projections/evaluationAnalytics.foldProjection"
);

const TENANT_ID = "project_evalanalyticsloglevel";
const EVALUATION_ID = "eval-log-level";

const REFUSED = new Error("Too many queries in flight");

/** A client whose every insert is refused, the way a shedding pool refuses. */
function refusingRepository() {
  return new EvaluationAnalyticsClickHouseRepository(
    async () =>
      ({
        insert: async () => {
          throw REFUSED;
        },
      }) as never,
  );
}

function row() {
  return {
    tenantId: TENANT_ID,
    evaluationId: EVALUATION_ID,
    projectionVersion: EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST,
  } as never;
}

describe("evaluation analytics writes that ClickHouse refuses", () => {
  describe("given the repository rethrows for the queue to retry", () => {
    /** @scenario "An evaluation analytics write failure beneath the queue is a warning" */
    it("logs at warning level, not error", async () => {
      logger.warn.mockClear();
      logger.error.mockClear();

      await expect(refusingRepository().upsert(row())).rejects.toThrow(REFUSED);

      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    /** @scenario "A layer that rethrows logs below error" */
    it("keeps the identifiers only this layer holds", async () => {
      logger.warn.mockClear();

      await expect(refusingRepository().upsert(row())).rejects.toThrow(REFUSED);

      expect(logger.warn.mock.calls[0]?.[0]).toMatchObject({
        tenantId: TENANT_ID,
        evaluationId: EVALUATION_ID,
      });
    });

    // A bare string under `error` loses the stack, and the log collector drops
    // the field outright (saas#1041). The Error instance has to reach pino.
    /** @scenario "A layer that rethrows logs below error" */
    it("passes the Error instance so the stack survives", async () => {
      logger.warn.mockClear();

      await expect(refusingRepository().upsert(row())).rejects.toThrow(REFUSED);

      expect(logger.warn.mock.calls[0]?.[0]).toMatchObject({
        error: expect.any(Error),
      });
    });
  });

  describe("given a batch write the repository rethrows", () => {
    /** @scenario "An evaluation analytics write failure beneath the queue is a warning" */
    it("logs at warning level, not error", async () => {
      logger.warn.mockClear();
      logger.error.mockClear();

      await expect(
        refusingRepository().upsertBatch([{ row: row() }]),
      ).rejects.toThrow(REFUSED);

      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });
  });
});
