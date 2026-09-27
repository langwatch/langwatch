/**
 * A pass runs a wrapper around a statement the policy already accepted: the
 * wrapper holds it in a subquery, where an app function is refused, so the
 * pass is not walked again (main's instant-eval passes).
 * @see specs/instant-evals/instant-eval-pipeline.feature
 */
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import {
  LangWatchQLExecutorRepository,
  type LangWatchQLExecutionRequest,
  type LangWatchQLExecutionResult,
} from "../../repositories/langwatch-ql-executor.repository.ts";
import { LangWatchQLCapabilityService } from "../langwatch-ql-capability.service.ts";
import { LangWatchQLService } from "../langwatch-ql.service.ts";

const PROJECT = { id: "project-1", lwqlKey: "key-1" };
const STATEMENT =
  "SELECT TraceId, eval(TraceName, 'Is the name a greeting?') AS named FROM analytics.traces";
const PROBE = `SELECT * FROM (\n${STATEMENT}\n) AS q LIMIT 0`;

class RecordingExecutor extends LangWatchQLExecutorRepository {
  readonly requests: LangWatchQLExecutionRequest[] = [];

  execute(request: LangWatchQLExecutionRequest): Promise<LangWatchQLExecutionResult> {
    this.requests.push(request);

    return Promise.resolve({
      columns: [
        { name: "TraceId", type: "String" },
        { name: "named", type: "String" },
      ],
      rows: [],
      statistics: { elapsedMs: 1, rowsRead: 0, bytesRead: 0, rowsReturned: 0 },
    });
  }
}

function serviceOver(executor: RecordingExecutor) {
  return LangWatchQLService.create({
    executor,
    database: "analytics",
    limits: { maxRows: 100, maxResultBytes: 8_000_000 },
  });
}

describe("LangWatchQLService.executePass", () => {
  describe("given a statement calling eval at the top level, accepted for a run", () => {
    /** @scenario "A statement calling eval at the top level runs its passes" */
    it("runs the probe wrapper as the caller's restricted identity", async () => {
      const executor = new RecordingExecutor();
      const service = serviceOver(executor);
      service.validate({
        projectId: PROJECT.id,
        protections: {},
        sql: STATEMENT,
        isInstantEvalsEnabled: true,
      });

      const result = await service.executePass({ project: PROJECT, sql: PROBE });

      expect(result.columns.map((column) => column.name)).toEqual(["TraceId", "named"]);
      expect(executor.requests).toEqual([
        {
          sql: PROBE,
          tenantCapability: LangWatchQLCapabilityService.create().tenantCapability({
            secret: PROJECT.lwqlKey,
          }),
        },
      ]);
    });

    it("is refused for the eval call's position when walked as a submitted statement", async () => {
      const executor = new RecordingExecutor();

      const refusal = await serviceOver(executor)
        .execute({
          project: PROJECT,
          protections: {},
          sql: PROBE,
          isInstantEvalsEnabled: true,
        })
        .catch((error: unknown) => error);

      expect(HandledError.isHandled(refusal) && refusal.code).toBe("lwql_not_permitted");
      expect(executor.requests).toEqual([]);
    });
  });

  describe("given no restricted identity is provisioned", () => {
    it("refuses with lwql_unavailable", async () => {
      const service = LangWatchQLService.create({
        executor: null,
        database: "analytics",
        limits: { maxRows: 100, maxResultBytes: 8_000_000 },
      });

      const refusal = await service
        .executePass({ project: PROJECT, sql: PROBE })
        .catch((error: unknown) => error);

      expect(HandledError.isHandled(refusal) && refusal.code).toBe("lwql_unavailable");
    });
  });
});
