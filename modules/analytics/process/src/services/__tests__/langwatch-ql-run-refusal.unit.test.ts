/**
 * Running a period-aware statement with no window is refused; validating it is not.
 * @see modules/analytics/specs/analytics-lwql-workbench.feature
 */
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import {
  LangWatchQLExecutorRepository,
  type LangWatchQLExecutionRequest,
  type LangWatchQLExecutionResult,
} from "../../repositories/langwatch-ql-executor.repository.ts";
import { LangWatchQLService } from "../langwatch-ql.service.ts";
import { EVERY_CATALOGUE_PERMISSION } from "./lwql-catalogue-access.fixture.ts";

const PROJECT = { id: "project-1", lwqlKey: "key-1" };
const PROTECTIONS = { catalogue: EVERY_CATALOGUE_PERMISSION };
const SQL =
  "SELECT TraceId FROM analytics.traces WHERE Timestamp >= {dashboard_context_period_start:DateTime} AND Timestamp < {dashboard_context_period_end:DateTime}";

class UnreachedExecutor extends LangWatchQLExecutorRepository {
  execute(_request: LangWatchQLExecutionRequest): Promise<LangWatchQLExecutionResult> {
    return Promise.reject(new Error("the refusal must come before execution"));
  }
}

describe("given SQL declaring the reserved period parameters", () => {
  const service = LangWatchQLService.create({
    executor: new UnreachedExecutor(),
    database: "analytics",
    limits: { maxRows: 100, maxResultBytes: 8_000_000 },
  });

  describe("when it is run with no time window at all", () => {
    /** @scenario "A period-aware statement run with no window is refused naming the unset parameters" */
    it("is refused with lwql_parameter_missing naming both, while validate is not refused", async () => {
      const error = await service
        .execute({ project: PROJECT, protections: PROTECTIONS, sql: SQL })
        .then(
          () => undefined,
          (caught: unknown) => caught,
        );

      expect(HandledError.isHandled(error) ? error.code : undefined).toBe("lwql_parameter_missing");
      expect(HandledError.isHandled(error) ? JSON.stringify(error.meta) : "").toContain(
        "dashboard_context_period_start",
      );
      expect(HandledError.isHandled(error) ? JSON.stringify(error.meta) : "").toContain(
        "dashboard_context_period_end",
      );

      const validation = service.validate({
        projectId: PROJECT.id,
        protections: PROTECTIONS,
        sql: SQL,
      });
      expect(validation.awaitingTimeWindow).toEqual([
        "dashboard_context_period_end",
        "dashboard_context_period_start",
      ]);
    });
  });
});
