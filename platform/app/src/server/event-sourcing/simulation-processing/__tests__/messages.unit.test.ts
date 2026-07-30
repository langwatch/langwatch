import { describe, expect, it } from "vitest";
import { simulationRun } from "../aggregate";
import { simulationRunMessages } from "../index";
import {
  buildRunMessagesQuery,
  decodeRunMessageRows,
  mapMessageSnapshot,
  mapTextMessageEnd,
} from "../messages";
import { simulationRunMessagesTable } from "../table";

/**
 * @see specs/event-sourcing/simulation-run-aggregate.feature
 */

const RUN_ID = "run-1";

describe("the simulationRunMessages map projection", () => {
  it("subscribes to the two events that carry message content", () => {
    expect([...simulationRunMessages.eventTypes].sort()).toEqual([
      "lw.simulation_run.message_snapshot",
      "lw.simulation_run.text_message_end",
    ]);
  });

  /** @scenario "A message that has only started carries no transcript row yet" */
  it("produces no row for a message that has only started", () => {
    expect(
      simulationRunMessages.map(
        simulationRun.events.textMessageStart({
          scenarioRunId: RUN_ID,
          messageId: "m1",
          role: "assistant",
          messageIndex: 0,
          occurredAt: 1,
        }),
      ),
    ).toBeNull();
  });

  /** @scenario "A redelivered message does not duplicate the run's transcript" */
  it("re-derives the same row key for a redelivered message", () => {
    const event = simulationRun.events.textMessageEnd({
      scenarioRunId: RUN_ID,
      messageId: "m1",
      role: "assistant",
      content: "hi",
      messageIndex: 0,
      occurredAt: 10,
    });

    expect(simulationRunMessages.map(event)).toEqual(
      simulationRunMessages.map(event),
    );
  });
});

describe("mapMessageSnapshot", () => {
  it("emits one row per message, numbered by its position", () => {
    const rows = mapMessageSnapshot({
      scenarioRunId: RUN_ID,
      messages: [
        { id: "m1", role: "user", content: "hello", trace_id: "trace-1" },
        { id: "m2", role: "assistant", content: "hi" },
      ],
      traceIds: [],
      occurredAt: 1,
    });

    expect(rows).toEqual([
      {
        ScenarioRunId: RUN_ID,
        MessageId: "m1",
        MessageIndex: 0,
        Role: "user",
        Content: "hello",
        TraceId: "trace-1",
        Rest: "",
      },
      {
        ScenarioRunId: RUN_ID,
        MessageId: "m2",
        MessageIndex: 1,
        Role: "assistant",
        Content: "hi",
        TraceId: "",
        Rest: "",
      },
    ]);
  });

  it("keys a message with no id of its own by its position", () => {
    const [row] = mapMessageSnapshot({
      scenarioRunId: RUN_ID,
      messages: [{ role: "user", content: "hello" }],
      traceIds: [],
      occurredAt: 1,
    });

    expect(row!.MessageId).toBe("#0");
  });

  it("caps a message that carries inline media rather than storing it", () => {
    const [row] = mapMessageSnapshot({
      scenarioRunId: RUN_ID,
      messages: [{ id: "m1", role: "user", content: "x".repeat(200_000) }],
      traceIds: [],
      occurredAt: 1,
    });

    expect(row!.Content).toMatch(/^\[truncated: 200000 bytes/);
  });

  it("keeps the AG-UI fields it has no column for as JSON", () => {
    const [row] = mapMessageSnapshot({
      scenarioRunId: RUN_ID,
      messages: [{ id: "m1", role: "user", content: "hi", toolCalls: ["a"] }],
      traceIds: [],
      occurredAt: 1,
    });

    expect(JSON.parse(row!.Rest)).toEqual({ toolCalls: ["a"] });
  });
});

describe("mapTextMessageEnd", () => {
  it("carries the completed message's content, role and trace", () => {
    expect(
      mapTextMessageEnd({
        scenarioRunId: RUN_ID,
        messageId: "m1",
        role: "assistant",
        content: "hi",
        traceId: "trace-2",
        messageIndex: 3,
        occurredAt: 10,
      }),
    ).toEqual({
      ScenarioRunId: RUN_ID,
      MessageId: "m1",
      MessageIndex: 3,
      Role: "assistant",
      Content: "hi",
      TraceId: "trace-2",
      Rest: "",
    });
  });
});

/** Substitutes each bound `Identifier` back in, so a shape is readable. */
function readable(query: {
  sql: string;
  params: Record<string, unknown>;
}): string {
  return query.sql.replace(/\{(id\d+):Identifier\}/g, (_match, key: string) =>
    String(query.params[key]),
  );
}

describe("buildRunMessagesQuery", () => {
  const built = buildRunMessagesQuery({
    tenantId: "tenant-1",
    scenarioRunId: RUN_ID,
  });
  const sql = readable(built);

  /** @scenario "A redelivered message does not duplicate the run's transcript" */
  it("dedups on the table's own engine key before returning rows", () => {
    expect(simulationRunMessagesTable.sortKey).toEqual([
      "TenantId",
      "ScenarioRunId",
      "MessageId",
    ]);
    expect(sql).toContain("GROUP BY TenantId, ScenarioRunId, MessageId");
    expect(sql).toMatch(/IN \(/);
  });

  it("binds every table and column name rather than interpolating it", () => {
    expect(built.sql).not.toContain("simulation_run_messages");
    expect(Object.values(built.params)).toContain("simulation_run_messages");
    expect(Object.values(built.params)).toContain("MessageId");
  });

  it("scopes both the outer query and the dedup subquery to one run", () => {
    const scoped = built.sql.match(/= \{scenarioRunId:String\}/g) ?? [];
    expect(scoped.length).toBe(2);
    expect(built.params).toMatchObject({
      tenantId: "tenant-1",
      scenarioRunId: RUN_ID,
    });
  });

  it("orders the transcript by the producer's own message numbering", () => {
    expect(sql).toMatch(/ORDER BY MessageIndex, MessageId$/);
  });
});

describe("decodeRunMessageRows", () => {
  it("reconstructs one message per row", () => {
    expect(
      decodeRunMessageRows([["m1", 0, "user", "hello", "trace-1", ""]]),
    ).toEqual([
      {
        id: "m1",
        index: 0,
        role: "user",
        content: "hello",
        traceId: "trace-1",
        rest: "",
      },
    ]);
  });

  it("returns an empty transcript for an empty result", () => {
    expect(decodeRunMessageRows([])).toEqual([]);
  });
});
