import { describe, expect, it, vi } from "vitest";
import { RetroactiveUpdateService } from "../retroactive/retroactiveUpdate.service";
import { RETENTION_TABLE_CATEGORY_MAP } from "../retentionPolicy.schema";

describe("RetroactiveUpdateService", () => {
  describe("triggerUpdate()", () => {
    describe("given the traces category is updated", () => {
      /** @scenario Retroactive retention update applies uniformly across all retention-managed tables */
      it("issues the same WHERE clause shape for every retention-managed traces table including event_log", async () => {
        const command = vi.fn().mockResolvedValue(undefined);
        const query = vi.fn().mockResolvedValue({ json: async () => [] });
        const service = new RetroactiveUpdateService(
          async () => ({ command, query }) as any,
        );

        await service.triggerUpdate({
          projectId: "project-1",
          category: "traces",
          newRetentionDays: 90,
        });

        const issuedQueries = command.mock.calls.map(
          ([request]) => request.query as string,
        );

        // Every traces-category table should be updated
        const tracesTables = Object.entries(RETENTION_TABLE_CATEGORY_MAP)
          .filter(([, cat]) => cat === "traces")
          .map(([table]) => table);

        for (const table of tracesTables) {
          expect(
            issuedQueries.some(
              (sql) =>
                sql.includes(`ALTER TABLE ${table}`) &&
                sql.includes("_retention_days = 90") &&
                sql.includes("WHERE TenantId = 'project-1'") &&
                sql.includes("_retention_days != 90"),
            ),
            `expected uniform update for table: ${table}`,
          ).toBe(true);
        }

        // event_log is in traces category and must NOT have a TraceId clause
        expect(
          issuedQueries.some(
            (sql) =>
              sql.includes("ALTER TABLE event_log") &&
              sql.includes("TraceId"),
          ),
        ).toBe(false);

        // No NOT IN clause anywhere — no pin exclusion
        expect(issuedQueries.some((sql) => sql.includes("NOT IN"))).toBe(false);

        // No isNull anywhere
        expect(issuedQueries.some((sql) => sql.includes("isNull"))).toBe(false);
      });
    });

    describe("given the scenarios category is updated", () => {
      it("issues uniform updates across simulation_runs and suite_runs", async () => {
        const command = vi.fn().mockResolvedValue(undefined);
        const query = vi.fn().mockResolvedValue({ json: async () => [] });
        const service = new RetroactiveUpdateService(
          async () => ({ command, query }) as any,
        );

        await service.triggerUpdate({
          projectId: "project-1",
          category: "scenarios",
          newRetentionDays: 60,
        });

        const issuedQueries = command.mock.calls.map(
          ([request]) => request.query as string,
        );

        expect(
          issuedQueries.some(
            (sql) =>
              sql.includes("ALTER TABLE simulation_runs") &&
              sql.includes("_retention_days = 60") &&
              sql.includes("WHERE TenantId = 'project-1'"),
          ),
        ).toBe(true);

        expect(
          issuedQueries.some(
            (sql) =>
              sql.includes("ALTER TABLE suite_runs") &&
              sql.includes("_retention_days = 60"),
          ),
        ).toBe(true);
      });
    });

    describe("given the experiments category is updated", () => {
      it("issues uniform updates across experiment_runs and experiment_run_items", async () => {
        const command = vi.fn().mockResolvedValue(undefined);
        const query = vi.fn().mockResolvedValue({ json: async () => [] });
        const service = new RetroactiveUpdateService(
          async () => ({ command, query }) as any,
        );

        await service.triggerUpdate({
          projectId: "project-1",
          category: "experiments",
          newRetentionDays: 120,
        });

        const issuedQueries = command.mock.calls.map(
          ([request]) => request.query as string,
        );

        expect(
          issuedQueries.some(
            (sql) =>
              sql.includes("ALTER TABLE experiment_runs") &&
              sql.includes("_retention_days = 120"),
          ),
        ).toBe(true);

        expect(
          issuedQueries.some(
            (sql) =>
              sql.includes("ALTER TABLE experiment_run_items") &&
              sql.includes("_retention_days = 120"),
          ),
        ).toBe(true);
      });
    });
  });

  describe("getMutationProgress()", () => {
    describe("given retention-managed table mutations exist", () => {
      it("returns category for each mutation derived from RETENTION_TABLE_CATEGORY_MAP", async () => {
        const mockRows = [
          {
            mutationId: "mut-1",
            table: "stored_spans",
            isDone: 0,
            partsToDo: 5,
            createTime: "2026-01-01T00:00:00",
          },
          {
            mutationId: "mut-2",
            table: "event_log",
            isDone: 0,
            partsToDo: 3,
            createTime: "2026-01-01T00:01:00",
          },
          {
            mutationId: "mut-3",
            table: "simulation_runs",
            isDone: 0,
            partsToDo: 2,
            createTime: "2026-01-01T00:02:00",
          },
        ];

        const query = vi.fn().mockResolvedValue({
          json: async () => mockRows,
        });
        const service = new RetroactiveUpdateService(
          async () => ({ query }) as any,
        );

        const progress = await service.getMutationProgress({
          projectId: "project-1",
        });

        const storedSpans = progress.find((m) => m.table === "stored_spans");
        const eventLog = progress.find((m) => m.table === "event_log");
        const simRuns = progress.find((m) => m.table === "simulation_runs");

        expect(storedSpans?.category).toBe("traces");
        expect(eventLog?.category).toBe("traces");
        expect(simRuns?.category).toBe("scenarios");
      });
    });
  });
});
