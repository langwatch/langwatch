import { describe, expect, it, vi } from "vitest";
import { RETENTION_TABLE_CATEGORY_MAP } from "../retentionPolicy.schema";
import {
  RetroactiveMutationInProgressError,
  RetroactiveUpdateService,
} from "../retroactive/retroactiveUpdate.service";

describe("RetroactiveUpdateService", () => {
  describe("triggerUpdate()", () => {
    describe("given the traces category is updated", () => {
      /** @scenario Retroactive retention update applies uniformly across all retention-managed tables */
      it("issues a parametrized ALTER TABLE per traces table including event_log", async () => {
        const command = vi.fn().mockResolvedValue(undefined);
        const query = vi.fn().mockResolvedValue({ json: async () => [] });
        const service = new RetroactiveUpdateService(
          async () => ({ command, query }) as any,
        );

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
            (c.query as string).includes(`ALTER TABLE ${table}`),
          );
          expect(
            call,
            `expected uniform update for table: ${table}`,
          ).toBeDefined();
          expect(call!.query).toContain(
            "UPDATE _retention_days = {retentionDays:UInt16}",
          );
          expect(call!.query).toContain("WHERE TenantId = {tenantId:String}");
          expect(call!.query).toContain(
            "_retention_days != {retentionDays:UInt16}",
          );
          expect(call!.query_params).toEqual({
            tenantId: "project-1",
            retentionDays: 91,
          });
        }

        // event_log is in traces category and must NOT have a TraceId clause
        expect(
          issuedCalls.some(
            (c) =>
              (c.query as string).includes("ALTER TABLE event_log") &&
              (c.query as string).includes("TraceId"),
          ),
        ).toBe(false);

        // No NOT IN clause anywhere — no pin exclusion
        expect(
          issuedCalls.some((c) => (c.query as string).includes("NOT IN")),
        ).toBe(false);

        // No literal projectId interpolation anywhere
        expect(
          issuedCalls.some((c) => (c.query as string).includes("'project-1'")),
        ).toBe(false);
      });
    });

    describe("given the scenarios category is updated", () => {
      it("issues parametrized updates across simulation_runs and suite_runs", async () => {
        const command = vi.fn().mockResolvedValue(undefined);
        const query = vi.fn().mockResolvedValue({ json: async () => [] });
        const service = new RetroactiveUpdateService(
          async () => ({ command, query }) as any,
        );

        await service.triggerUpdate({
          projectId: "project-1",
          category: "scenarios",
          newRetentionDays: 63,
        });

        const issuedCalls = command.mock.calls.map(([request]) => request);

        const simCall = issuedCalls.find((c) =>
          (c.query as string).includes("ALTER TABLE simulation_runs"),
        );
        expect(simCall).toBeDefined();
        expect(simCall!.query_params).toEqual({
          tenantId: "project-1",
          retentionDays: 63,
        });

        const suiteCall = issuedCalls.find((c) =>
          (c.query as string).includes("ALTER TABLE suite_runs"),
        );
        expect(suiteCall).toBeDefined();
        expect(suiteCall!.query_params).toEqual({
          tenantId: "project-1",
          retentionDays: 63,
        });
      });
    });

    describe("given the experiments category is updated", () => {
      it("issues parametrized updates across experiment_runs and experiment_run_items", async () => {
        const command = vi.fn().mockResolvedValue(undefined);
        const query = vi.fn().mockResolvedValue({ json: async () => [] });
        const service = new RetroactiveUpdateService(
          async () => ({ command, query }) as any,
        );

        await service.triggerUpdate({
          projectId: "project-1",
          category: "experiments",
          newRetentionDays: 119,
        });

        const issuedCalls = command.mock.calls.map(([request]) => request);

        const runsCall = issuedCalls.find((c) =>
          (c.query as string).includes("ALTER TABLE experiment_runs"),
        );
        expect(runsCall).toBeDefined();
        expect(runsCall!.query_params).toEqual({
          tenantId: "project-1",
          retentionDays: 119,
        });

        const itemsCall = issuedCalls.find((c) =>
          (c.query as string).includes("ALTER TABLE experiment_run_items"),
        );
        expect(itemsCall).toBeDefined();
        expect(itemsCall!.query_params).toEqual({
          tenantId: "project-1",
          retentionDays: 119,
        });
      });
    });

    describe("when a mutation is already in progress for a table", () => {
      /** @scenario Conflict error names the mutation IDs callers can kill */
      it("throws RetroactiveMutationInProgressError listing mutationId + table for every blocker", async () => {
        const command = vi.fn().mockResolvedValue(undefined);
        const query = vi.fn().mockResolvedValue({
          json: async () => [
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
          ],
        });
        const service = new RetroactiveUpdateService(
          async () => ({ command, query }) as any,
        );

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

        // Tenant filter flows through query_params, not raw SQL.
        const [request] = query.mock.calls[0]!;
        expect(request.query_params).toEqual({
          tenantFilterNeedle: "WHERE TenantId = 'project-1'",
        });
        // Raw projectId only appears inside the parameter value, not in the
        // query body itself (which references {tenantFilterNeedle:String}).
        expect(request.query).not.toContain("'project-1'");
      });
    });
  });

  describe("killMutation()", () => {
    it("parametrizes mutation_id and tenant filter", async () => {
      const command = vi.fn().mockResolvedValue(undefined);
      const service = new RetroactiveUpdateService(
        async () => ({ command }) as any,
      );

      await service.killMutation({
        projectId: "project-1",
        mutationId: "mut-xyz",
      });

      expect(command).toHaveBeenCalledTimes(1);
      const [request] = command.mock.calls[0]!;
      expect(request.query).toContain("mutation_id = {mutationId:String}");
      expect(request.query_params).toEqual({
        mutationId: "mut-xyz",
        tenantFilterNeedle: "WHERE TenantId = 'project-1'",
      });
      expect(request.query).not.toContain("'mut-xyz'");
    });
  });
});
