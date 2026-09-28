import { createClient } from "@clickhouse/client";
import { describe, expect, it, vi } from "vitest";
import { eventLogRetentionCategoryMutationMarkerSql } from "../event-log-retention-policy";
import { RETENTION_TABLE_CATEGORY_MAP } from "../retentionPolicy.schema";
import {
  RetroactiveMutationInProgressError,
  RetroactiveUpdateService,
} from "../retroactive/retroactiveUpdate.service";

function createMockClickHouseClient({
  command = vi.fn(),
  query = vi.fn(),
}: {
  command?: ReturnType<typeof vi.fn>;
  query?: ReturnType<typeof vi.fn>;
}) {
  const client = createClient({ url: "http://127.0.0.1:8123" });

  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === "command") return command;
      if (property === "query") return query;
      return Reflect.get(target, property, receiver);
    },
  });
}

describe("RetroactiveUpdateService", () => {
  describe("triggerUpdate()", () => {
    describe("given the traces category is updated", () => {
      /** @scenario Retroactive retention update applies uniformly across all retention-managed tables */
      it("updates trace-class event rows without overwriting indefinite rows", async () => {
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

        const eventLogCall = issuedCalls.find((c) =>
          (c.query as string).includes("ALTER TABLE event_log"),
        );
        expect(eventLogCall).toBeDefined();
        expect(eventLogCall!.query).toContain(
          "startsWith(EventType, 'lw.identity.')",
        );
        expect(eventLogCall!.query).toContain(
          "startsWith(EventType, 'lw.authz.')",
        );
        expect(eventLogCall!.query).toContain(
          "EventType IN ('lw.governance.vk_lifecycle')",
        );
        expect(eventLogCall!.query).not.toContain("'governance_subject'");
        expect(eventLogCall!.query).not.toContain("'coding_agent_session'");
        expect(eventLogCall!.query).not.toContain("'gateway_request'");
        expect(eventLogCall!.query).toContain(
          "AggregateType NOT IN ('experiment_run', 'simulation_run', 'simulation_set', 'suite_run')",
        );
        expect(eventLogCall!.query).toContain(
          eventLogRetentionCategoryMutationMarkerSql("traces"),
        );

        expect(
          issuedCalls.some((call) =>
            (call.query as string).includes(
              "ALTER TABLE langy_analytics_events",
            ),
          ),
        ).toBe(true);

        // No literal projectId interpolation anywhere
        expect(
          issuedCalls.some((c) => (c.query as string).includes("'project-1'")),
        ).toBe(false);
      });
    });

    describe("given the scenarios category is updated", () => {
      /** @scenario "Retroactive updates select the matching event-log category" */
      it("updates scenario tables and only scenario-class event rows", async () => {
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

        const eventLogCall = issuedCalls.find((c) =>
          (c.query as string).includes("ALTER TABLE event_log"),
        );
        expect(eventLogCall).toBeDefined();
        expect(eventLogCall!.query).toContain(
          "AggregateType IN ('simulation_run', 'simulation_set', 'suite_run')",
        );
        expect(eventLogCall!.query).toContain(
          "startsWith(EventType, 'lw.identity.')",
        );
        expect(eventLogCall!.query).toContain(
          eventLogRetentionCategoryMutationMarkerSql("scenarios"),
        );
      });
    });

    describe("given the experiments category is updated", () => {
      /** @scenario "Retroactive updates select the matching event-log category" */
      it("updates experiment tables and only experiment-class event rows", async () => {
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

        const eventLogCall = issuedCalls.find((c) =>
          (c.query as string).includes("ALTER TABLE event_log"),
        );
        expect(eventLogCall).toBeDefined();
        expect(eventLogCall!.query).toContain(
          "AggregateType IN ('experiment_run')",
        );
        expect(eventLogCall!.query).toContain(
          eventLogRetentionCategoryMutationMarkerSql("experiments"),
        );
      });
    });

    describe("when event-log category mutations overlap", () => {
      /** @scenario "Event-log category mutations can run in parallel" */
      it("allows trace, scenario, and experiment mutations to coexist", async () => {
        const activeEventLogMutations: Array<{
          mutationId: string;
          table: string;
          isDone: number;
          partsToDo: number;
          createTime: string;
          command: string;
        }> = [];
        const command = vi
          .fn()
          .mockImplementation(async (request: { query: string }) => {
            if (!request.query.includes("ALTER TABLE event_log")) return;

            activeEventLogMutations.push({
              mutationId: `event-log-${activeEventLogMutations.length + 1}`,
              table: "event_log",
              isDone: 0,
              partsToDo: 1,
              createTime: "2026-01-01T00:00:00",
              command: request.query,
            });
          });
        const query = vi.fn().mockImplementation(async () => ({
          json: async () => activeEventLogMutations,
        }));
        const client = createMockClickHouseClient({ command, query });
        const service = new RetroactiveUpdateService(async () => client);

        await service.triggerUpdate({
          projectId: "project-1",
          category: "traces",
          newRetentionDays: 49,
        });
        await service.triggerUpdate({
          projectId: "project-1",
          category: "scenarios",
          newRetentionDays: 63,
        });
        await service.triggerUpdate({
          projectId: "project-1",
          category: "experiments",
          newRetentionDays: 91,
        });

        expect(activeEventLogMutations).toHaveLength(3);
        expect(
          activeEventLogMutations.map(({ command }) =>
            (["traces", "scenarios", "experiments"] as const).find((category) =>
              command.includes(
                eventLogRetentionCategoryMutationMarkerSql(category),
              ),
            ),
          ),
        ).toEqual(["traces", "scenarios", "experiments"]);

        const progress = await service.getMutationProgress({
          projectId: "project-1",
        });
        expect(progress.map(({ category }) => category)).toEqual([
          "traces",
          "scenarios",
          "experiments",
        ]);

        await expect(
          service.triggerUpdate({
            projectId: "project-1",
            category: "scenarios",
            newRetentionDays: 63,
          }),
        ).rejects.toMatchObject({
          blocked: [
            expect.objectContaining({
              mutationId: "event-log-2",
              category: "scenarios",
            }),
          ],
        });
      });

      it("lets an unmarked legacy event-log mutation block every category", async () => {
        const query = vi.fn().mockResolvedValue({
          json: async () => [
            {
              mutationId: "legacy-event-log",
              table: "event_log",
              isDone: 0,
              partsToDo: 1,
              createTime: "2026-01-01T00:00:00",
              command:
                "UPDATE _retention_days = 49 WHERE TenantId = 'project-1'",
            },
          ],
        });
        const client = createMockClickHouseClient({ query });
        const service = new RetroactiveUpdateService(async () => client);

        for (const category of [
          "traces",
          "scenarios",
          "experiments",
        ] as const) {
          await expect(
            service.triggerUpdate({
              projectId: "project-1",
              category,
              newRetentionDays: 49,
            }),
          ).rejects.toMatchObject({
            blocked: [
              expect.objectContaining({
                mutationId: "legacy-event-log",
              }),
            ],
          });
        }
      });
    });

    describe("when a mutation is already in progress for a table", () => {
      /** @scenario "Rate-limited to one mutation per tenant, category, and table" */
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
      it("uses explicit markers for mixed event-log mutation categories", async () => {
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
            command: `UPDATE WHERE ${eventLogRetentionCategoryMutationMarkerSql("experiments")}`,
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
        expect(eventLog?.category).toBe("experiments");
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
      const query = vi.fn().mockResolvedValue({
        json: async () => [],
      });
      const service = new RetroactiveUpdateService(
        async () => ({ query }) as any,
      );

      await service.getMutationProgress({ projectId: "weird'\\id" });

      const [request] = query.mock.calls[0]!;
      // Backslash escaped first, then single quote — same order CH uses.
      expect(request.query_params).toEqual({
        tenantFilterNeedle: "WHERE TenantId = 'weird\\'\\\\id'",
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
