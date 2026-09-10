import { RetroactiveMutationInProgressError } from "@langwatch/data-retention-contract";
import { describe, expect, it } from "vitest";
import type { ClickHouseQueryClient, QueryRequest } from "@langwatch/clickhouse-client";
import { ClickHouseRetroactiveRetentionRepository } from "../clickhouse.retroactive-retention.repository.ts";

/**
 * The process's one ClickHouse client, stood in for. Nothing here resolves an
 * endpoint: each statement names the tenant it acts for and the client routes
 * it, which is what these cases record.
 */
function createRepository(rows: unknown) {
  const commands: QueryRequest[] = [];
  const queries: QueryRequest[] = [];
  const clickhouse = {
    async command(request: QueryRequest): Promise<void> {
      commands.push(request);
    },
    async query(request: QueryRequest): Promise<{ rows: unknown[] }> {
      queries.push(request);
      return { rows: rows as unknown[] };
    },
  } as unknown as ClickHouseQueryClient;

  return {
    commands,
    queries,
    repository: ClickHouseRetroactiveRetentionRepository.create({ clickhouse }),
  };
}

function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error("Expected test value to be present.");
  }

  return value;
}

describe("ClickHouseRetroactiveRetentionRepository", () => {
  /**
   * @scenario "Apply retention to existing project data"
   * @scenario Retroactive retention update applies uniformly across all retention-managed tables
   */
  it("updates every traces table, including event_log, with parameterized values", async () => {
    const { commands, repository } = createRepository([]);

    const result = await repository.triggerUpdate({
      projectId: "project-1",
      category: "traces",
      newRetentionDays: 91,
    });

    const expectedTables = [
      "event_log",
      "stored_spans",
      "stored_log_records",
      "log_records",
      "metric_data_points",
      "metric_series",
      "metric_time_rollups",
      "trace_summaries",
      "trace_analytics",
      "trace_analytics_rollup",
      "evaluation_runs",
      "evaluation_analytics",
      "evaluation_analytics_rollup",
      "langy_analytics_events",
      "dspy_steps",
    ];

    expect(result.tables).toEqual(expectedTables);
    expect(commands).toHaveLength(expectedTables.length);

    for (const table of expectedTables) {
      const command = required(
        commands.find((candidate) => candidate.sql.includes(`ALTER TABLE ${table}`)),
      );
      expect(command.sql).toContain("UPDATE _retention_days = {retentionDays:UInt16}");
      expect(command.sql).toContain("WHERE TenantId = {tenantId:String}");
      expect(command.sql).toContain("_retention_days != {retentionDays:UInt16}");
      expect(command.params).toEqual({ tenantId: "project-1", retentionDays: 91 });
    }

    expect(commands.some((command) => command.sql.includes("TraceId"))).toBe(false);
    expect(commands.some((command) => command.sql.includes("NOT IN"))).toBe(false);
    expect(commands.some((command) => command.sql.includes("'project-1'"))).toBe(false);
  });

  /** @scenario "Apply retention to existing project data" */
  it("updates the scenario and experiment tables for their categories", async () => {
    const scenarios = createRepository([]);
    await scenarios.repository.triggerUpdate({
      projectId: "project-1",
      category: "scenarios",
      newRetentionDays: 63,
    });
    expect(scenarios.commands.map((command) => command.sql)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("ALTER TABLE simulation_runs"),
        expect.stringContaining("ALTER TABLE suite_runs"),
      ]),
    );

    const experiments = createRepository([]);
    await experiments.repository.triggerUpdate({
      projectId: "project-1",
      category: "experiments",
      newRetentionDays: 119,
    });
    expect(experiments.commands.map((command) => command.sql)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("ALTER TABLE experiment_runs"),
        expect.stringContaining("ALTER TABLE experiment_run_items"),
      ]),
    );
  });

  /** @scenario "A second retroactive update is refused while the first is still running" */
  it("refuses by name and lists every blocking mutation with its id and table", async () => {
    const { commands, repository } = createRepository([
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

    const error = await repository
      .triggerUpdate({
        projectId: "project-1",
        category: "traces",
        newRetentionDays: 49,
      })
      .catch((cause: unknown) => cause);

    // The code, not the class: this error crosses the tRPC boundary, where the
    // browser keys its copy off `code` and `instanceof` no longer holds.
    expect(error).toMatchObject({
      code: "data_retention_mutation_in_progress",
      httpStatus: 409,
      isHandled: true,
    });
    if (!(error instanceof RetroactiveMutationInProgressError)) {
      throw error;
    }

    expect(error.blocked.map((mutation) => mutation.mutationId)).toEqual(["mut-1", "mut-2"]);

    expect(commands).toHaveLength(0);
  });

  it("maps progress categories and escapes the tenant filter through query parameters", async () => {
    const { queries, repository } = createRepository([
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
    ]);

    const progress = await repository.getMutationProgress({ projectId: "weird'\\id" });

    expect(progress.map((mutation) => mutation.category)).toEqual([
      "traces",
      "traces",
      "scenarios",
    ]);
    const query = required(queries[0]);
    expect(query.params).toEqual({
      tenantFilterNeedle: "WHERE TenantId = 'weird\\'\\\\id'",
    });
    expect(query.sql).not.toContain("weird'\\id");
  });

  it("parameterizes mutation cancellation and scopes it to the tenant", async () => {
    const { commands, repository } = createRepository([]);

    await repository.killMutation({ projectId: "project-1", mutationId: "mut-xyz" });

    const command = required(commands[0]);
    expect(command.sql).toContain("mutation_id = {mutationId:String}");
    expect(command.params).toEqual({
      mutationId: "mut-xyz",
      tenantFilterNeedle: "WHERE TenantId = 'project-1'",
    });
    expect(command.sql).not.toContain("'mut-xyz'");
  });
});
