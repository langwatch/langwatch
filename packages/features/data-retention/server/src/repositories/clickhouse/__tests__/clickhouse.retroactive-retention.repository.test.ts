import { RetroactiveMutationInProgressError } from "@langwatch/data-retention-contract";
import { describe, expect, it } from "vitest";
import {
  ClickHouseRetroactiveRetentionRepository,
  type RetentionClickHouseClient,
} from "../clickhouse.retroactive-retention.repository";

type QueryParams = Record<string, number | string | string[]>;
type CommandRequest = { query: string; query_params: QueryParams };
type QueryRequest = CommandRequest & { format: "JSONEachRow" };

function createClient(rows: unknown): {
  client: RetentionClickHouseClient;
  commands: CommandRequest[];
  queries: QueryRequest[];
} {
  const commands: CommandRequest[] = [];
  const queries: QueryRequest[] = [];
  const client: RetentionClickHouseClient = {
    async command(input): Promise<void> {
      commands.push(input);
    },
    async query(input): Promise<{ json(): Promise<unknown> }> {
      queries.push(input);
      return { json: async () => rows };
    },
  };

  return { client, commands, queries };
}

function createRepository(rows: unknown) {
  const fake = createClient(rows);
  const repository = ClickHouseRetroactiveRetentionRepository.create({
    resolveClient: async () => fake.client,
  });
  return { ...fake, repository };
}

function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error("Expected test value to be present.");
  }

  return value;
}

describe("ClickHouseRetroactiveRetentionRepository", () => {
  /** @scenario "Apply retention to existing project data" */
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
        commands.find((candidate) => candidate.query.includes(`ALTER TABLE ${table}`)),
      );
      expect(command.query).toContain("UPDATE _retention_days = {retentionDays:UInt16}");
      expect(command.query).toContain("WHERE TenantId = {tenantId:String}");
      expect(command.query).toContain("_retention_days != {retentionDays:UInt16}");
      expect(command.query_params).toEqual({ tenantId: "project-1", retentionDays: 91 });
    }

    expect(commands.some((command) => command.query.includes("TraceId"))).toBe(false);
    expect(commands.some((command) => command.query.includes("NOT IN"))).toBe(false);
    expect(commands.some((command) => command.query.includes("'project-1'"))).toBe(false);
  });

  /** @scenario "Apply retention to existing project data" */
  it("updates the scenario and experiment tables for their categories", async () => {
    const scenarios = createRepository([]);
    await scenarios.repository.triggerUpdate({
      projectId: "project-1",
      category: "scenarios",
      newRetentionDays: 63,
    });
    expect(scenarios.commands.map((command) => command.query)).toEqual(
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
    expect(experiments.commands.map((command) => command.query)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("ALTER TABLE experiment_runs"),
        expect.stringContaining("ALTER TABLE experiment_run_items"),
      ]),
    );
  });

  it("returns every blocking mutation with its id and table", async () => {
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

    expect(error).toBeInstanceOf(RetroactiveMutationInProgressError);
    if (!(error instanceof RetroactiveMutationInProgressError)) {
      throw error;
    }

    expect(error.blocked.map((mutation) => mutation.mutationId)).toEqual(["mut-1", "mut-2"]);
    expect(error.message).toContain("mut-1");
    expect(error.message).toContain("mut-2");

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
    expect(query.query_params).toEqual({
      tenantFilterNeedle: "WHERE TenantId = 'weird\\'\\\\id'",
    });
    expect(query.query).not.toContain("weird'\\id");
  });

  it("parameterizes mutation cancellation and scopes it to the tenant", async () => {
    const { commands, repository } = createRepository([]);

    await repository.killMutation({ projectId: "project-1", mutationId: "mut-xyz" });

    const command = required(commands[0]);
    expect(command.query).toContain("mutation_id = {mutationId:String}");
    expect(command.query_params).toEqual({
      mutationId: "mut-xyz",
      tenantFilterNeedle: "WHERE TenantId = 'project-1'",
    });
    expect(command.query).not.toContain("'mut-xyz'");
  });
});
