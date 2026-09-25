import type { QueryRequest } from "@langwatch/clickhouse-client";
import { RetroactiveMutationInProgressError } from "@langwatch/data-retention-contract";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { ClickHouseRetroactiveRetentionRepository } from "../clickhouse.retroactive-retention.repository.ts";

/**
 * The process's one ClickHouse client, stood in for. Nothing here resolves an
 * endpoint: each statement names the tenant it acts for and the client routes
 * it, which is what these cases record.
 */
function createRepository(rows: unknown) {
  const commands: QueryRequest[] = [];
  const queries: QueryRequest[] = [];
  const clickhouse = clickHouseQueryClientDouble({
    async command(request: QueryRequest): Promise<void> {
      commands.push(request);
    },
    async query(request: QueryRequest): Promise<{ rows: unknown[] }> {
      queries.push(request);
      return { rows: rows as unknown[] };
    },
  });

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
    expect(commands.some((command) => command.sql.includes("'project-1'"))).toBe(false);

    // event_log carries every category's rows plus a durable security slice,
    // so its own command additionally excludes indefinite rows and the other
    // finite categories' aggregates. No other table's rows need that filter.
    const eventLogCommand = required(
      commands.find((candidate) => candidate.sql.includes("ALTER TABLE event_log")),
    );
    expect(eventLogCommand.sql).toContain("AggregateType NOT IN");
    expect(eventLogCommand.sql).toContain("langwatch:event-log-retention-category:traces");
    expect(
      commands
        .filter((command) => !command.sql.includes("ALTER TABLE event_log"))
        .some((command) => command.sql.includes("NOT IN")),
    ).toBe(false);
  });

  /**
   * @scenario "Apply retention to existing project data"
   * @scenario "Retroactive updates select the matching event-log category"
   */
  it("updates the scenario and experiment tables for their categories, plus only their own event_log rows", async () => {
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
        expect.stringContaining("ALTER TABLE event_log"),
      ]),
    );
    const scenariosEventLog = required(
      scenarios.commands.find((command) => command.sql.includes("ALTER TABLE event_log")),
    );
    expect(scenariosEventLog.sql).toContain(
      "AggregateType IN ('simulation_run', 'simulation_set', 'suite_run')",
    );
    expect(scenariosEventLog.sql).toContain("langwatch:event-log-retention-category:scenarios");

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
        expect.stringContaining("ALTER TABLE event_log"),
      ]),
    );
    const experimentsEventLog = required(
      experiments.commands.find((command) => command.sql.includes("ALTER TABLE event_log")),
    );
    expect(experimentsEventLog.sql).toContain("AggregateType IN ('experiment_run')");
    expect(experimentsEventLog.sql).toContain("langwatch:event-log-retention-category:experiments");
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

  /** @scenario "Event-log category mutations can run in parallel" */
  it("does not block a different category on an in-flight event_log mutation for another category", async () => {
    const tracesMarkedRow = {
      mutationId: "mut-traces",
      table: "event_log",
      isDone: 0,
      partsToDo: 5,
      createTime: "2026-01-01T00:00:00",
      command:
        "ALTER TABLE event_log UPDATE _retention_days = 91 WHERE TenantId = 'project-1' " +
        "AND _retention_days != 91 AND (NOT (...)) " +
        "AND length('langwatch:event-log-retention-category:traces') > 0",
    };

    const scenarios = createRepository([tracesMarkedRow]);
    const result = await scenarios.repository.triggerUpdate({
      projectId: "project-1",
      category: "scenarios",
      newRetentionDays: 63,
    });
    // Not blocked: the in-flight mutation is marked for a disjoint row set.
    expect(result.tables).toContain("event_log");

    const traces = createRepository([tracesMarkedRow]);
    const error = await traces.repository
      .triggerUpdate({ projectId: "project-1", category: "traces", newRetentionDays: 91 })
      .catch((cause: unknown) => cause);
    // Blocked: same category as the in-flight mutation's marker.
    expect(error).toBeInstanceOf(RetroactiveMutationInProgressError);
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

    const progress = await repository.findMutationProgress({ projectId: "weird'\\id" });

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
