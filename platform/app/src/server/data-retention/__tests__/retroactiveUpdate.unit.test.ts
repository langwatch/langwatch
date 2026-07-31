import { describe, expect, it, vi } from "vitest";
import type { TenantClickHouseClient } from "~/server/app-layer/clients/clickhouse/tenant-client";
import { RETENTION_TABLE_CATEGORY_MAP } from "../retentionPolicy.schema";
import {
  RetroactiveMutationInProgressError,
  RetroactiveUpdateService,
} from "../retroactive/retroactiveUpdate.service";

/**
 * A service wired to a fake tenant client. `query` hands back decoded rows
 * directly — no ResultSet, no `.json()` — which is what the seam's `query`
 * returns.
 */
function makeService(rows: unknown[] = []) {
  const command = vi.fn().mockResolvedValue(undefined);
  const query = vi.fn().mockResolvedValue(rows);
  const client = { command, query } as unknown as TenantClickHouseClient;
  return {
    service: new RetroactiveUpdateService(async () => client),
    command,
    query,
  };
}

describe("RetroactiveUpdateService", () => {
  describe("triggerUpdate()", () => {
    describe("given the traces category is updated", () => {
      /** @scenario Retroactive retention update applies uniformly across all retention-managed tables */
      /** @scenario "Explicit retroactive update applies to existing data" */
      it("issues a parametrized ALTER TABLE per traces table including event_log", async () => {
        const { service, command } = makeService();

        await service.triggerUpdate({
          projectId: "project-1",
          category: "traces",
          newRetentionDays: 91,
        });

        const issuedCalls = command.mock.calls.map(([request]) => request);

        // Every traces-category table should be updated
        const tracesTables = Object.entries(RETENTION_TABLE_CATEGORY_MAP)
          .filter(([, cat]) => cat === "traces")
          .map(([table]) => table);

        for (const table of tracesTables) {
          const call = issuedCalls.find((c) =>
            (c.sql as string).includes(`ALTER TABLE ${table}`),
          );
          expect(
            call,
            `expected uniform update for table: ${table}`,
          ).toBeDefined();
          expect(call!.sql).toContain(
            "UPDATE _retention_days = {retentionDays:UInt16}",
          );
          expect(call!.sql).toContain("WHERE TenantId = {tenantId:String}");
          expect(call!.sql).toContain(
            "_retention_days != {retentionDays:UInt16}",
          );
          expect(call!.params).toEqual({
            tenantId: "project-1",
            retentionDays: 91,
          });
        }

        // event_log is in traces category and must NOT have a TraceId clause
        expect(
          issuedCalls.some(
            (c) =>
              (c.sql as string).includes("ALTER TABLE event_log") &&
              (c.sql as string).includes("TraceId"),
          ),
        ).toBe(false);

        expect(
          issuedCalls.some((call) =>
            (call.sql as string).includes("ALTER TABLE langy_analytics_events"),
          ),
        ).toBe(true);

        // No NOT IN clause anywhere — no pin exclusion
        expect(
          issuedCalls.some((c) => (c.sql as string).includes("NOT IN")),
        ).toBe(false);

        // No literal projectId interpolation anywhere
        expect(
          issuedCalls.some((c) => (c.sql as string).includes("'project-1'")),
        ).toBe(false);
      });
    });

    describe("given the scenarios category is updated", () => {
      it("issues parametrized updates across simulation_runs and suite_runs", async () => {
        const { service, command } = makeService();

        await service.triggerUpdate({
          projectId: "project-1",
          category: "scenarios",
          newRetentionDays: 63,
        });

        const issuedCalls = command.mock.calls.map(([request]) => request);

        const simCall = issuedCalls.find((c) =>
          (c.sql as string).includes("ALTER TABLE simulation_runs"),
        );
        expect(simCall).toBeDefined();
        expect(simCall!.params).toEqual({
          tenantId: "project-1",
          retentionDays: 63,
        });

        const suiteCall = issuedCalls.find((c) =>
          (c.sql as string).includes("ALTER TABLE suite_runs"),
        );
        expect(suiteCall).toBeDefined();
        expect(suiteCall!.params).toEqual({
          tenantId: "project-1",
          retentionDays: 63,
        });
      });
    });

    describe("given the experiments category is updated", () => {
      it("issues parametrized updates across experiment_runs and experiment_run_items", async () => {
        const { service, command } = makeService();

        await service.triggerUpdate({
          projectId: "project-1",
          category: "experiments",
          newRetentionDays: 119,
        });

        const issuedCalls = command.mock.calls.map(([request]) => request);

        const runsCall = issuedCalls.find((c) =>
          (c.sql as string).includes("ALTER TABLE experiment_runs"),
        );
        expect(runsCall).toBeDefined();
        expect(runsCall!.params).toEqual({
          tenantId: "project-1",
          retentionDays: 119,
        });

        const itemsCall = issuedCalls.find((c) =>
          (c.sql as string).includes("ALTER TABLE experiment_run_items"),
        );
        expect(itemsCall).toBeDefined();
        expect(itemsCall!.params).toEqual({
          tenantId: "project-1",
          retentionDays: 119,
        });
      });
    });

    describe("when a mutation is already in progress for a table", () => {
      /** @scenario Conflict error names the mutation IDs callers can kill */
      /** @scenario "Rate-limited to one mutation per tenant per table" */
      it("throws RetroactiveMutationInProgressError listing mutationId + table for every blocker", async () => {
        const { service, command } = makeService([
          {
            mutationId: "mut-1",
            table: "stored_spans",
            isDone: 0,
            partsToDo: 5,
            createTime: "2026-01-01T00:00:00",
          },
          {
            mutationId: "mut-2",
            table: "trace_summaries",
            isDone: 0,
            partsToDo: 2,
            createTime: "2026-01-01T00:01:00",
          },
        ]);

        await expect(
          service.triggerUpdate({
            projectId: "project-1",
            category: "traces",
            newRetentionDays: 49,
          }),
        ).rejects.toMatchObject({
          name: "RetroactiveMutationInProgressError",
        });

        try {
          await service.triggerUpdate({
            projectId: "project-1",
            category: "traces",
            newRetentionDays: 49,
          });
        } catch (e) {
          expect(e).toBeInstanceOf(RetroactiveMutationInProgressError);
          const err = e as RetroactiveMutationInProgressError;
          // Caller can now act on the IDs without scraping the message.
          expect(err.blocked.map((b) => b.mutationId)).toEqual([
            "mut-1",
            "mut-2",
          ]);
          expect(err.message).toContain("mut-1");
          expect(err.message).toContain("mut-2");
        }

        // No ALTER TABLE was attempted
        expect(command).not.toHaveBeenCalled();
      });
    });
  });

  describe("getMutationProgress()", () => {
    describe("given retention-managed table mutations exist", () => {
      /** @scenario "Retroactive update progress is tracked" */
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

        const { service, query } = makeService(mockRows);

        const progress = await service.getMutationProgress({
          projectId: "project-1",
        });

        const storedSpans = progress.find((m) => m.table === "stored_spans");
        const eventLog = progress.find((m) => m.table === "event_log");
        const simRuns = progress.find((m) => m.table === "simulation_runs");

        expect(storedSpans?.category).toBe("traces");
        expect(eventLog?.category).toBe("traces");
        expect(simRuns?.category).toBe("scenarios");

        // Tenant filter flows through query parameters, not raw SQL.
        const [request] = query.mock.calls[0]!;
        expect(request.params).toEqual({
          tenantFilterNeedle: "WHERE TenantId = 'project-1'",
        });
        // Raw projectId only appears inside the parameter value, not in the
        // query body itself (which references {tenantFilterNeedle:String}).
        expect(request.sql).not.toContain("'project-1'");
      });
    });
  });

  describe("when the projectId contains a single quote or backslash", () => {
    /**
     * Regression: previously the tenant filter needle was built by raw
     * interpolation `WHERE TenantId = '${projectId}'`. CH stores ALTER
     * commands with the rendered SQL — single quotes/backslashes get
     * escaped in the stored text. Without matching that escape on our
     * side, the needle would never match and concurrent-mutation
     * detection would silently return empty, letting a second ALTER
     * through. Mirrors the CodeQL "incomplete escaping" finding too.
     */
    it("escapes single quotes and backslashes in the needle", async () => {
      const { service, query } = makeService();

      await service.getMutationProgress({ projectId: "weird'\\id" });

      const [request] = query.mock.calls[0]!;
      // Backslash escaped first, then single quote — same order CH uses.
      expect(request.params).toEqual({
        tenantFilterNeedle: "WHERE TenantId = 'weird\\'\\\\id'",
      });
    });
  });

  describe("killMutation()", () => {
    /** @scenario "Stuck mutation can be killed" */
    it("parametrizes mutation_id and tenant filter", async () => {
      const { service, command } = makeService();

      await service.killMutation({
        projectId: "project-1",
        mutationId: "mut-xyz",
      });

      expect(command).toHaveBeenCalledTimes(1);
      const [request] = command.mock.calls[0]!;
      expect(request.sql).toContain("mutation_id = {mutationId:String}");
      expect(request.params).toEqual({
        mutationId: "mut-xyz",
        tenantFilterNeedle: "WHERE TenantId = 'project-1'",
      });
      expect(request.sql).not.toContain("'mut-xyz'");
    });
  });
});
