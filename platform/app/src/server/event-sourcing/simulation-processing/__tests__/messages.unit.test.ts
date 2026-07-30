import { describe, expect, it } from "vitest";
import {
  buildRunMessagesQuery,
  decodeRunMessageRows,
  mapMessageSnapshot,
  mapTextMessageEnd,
  simulationMessageRecordSchema,
} from "../messages";
import { simulationRunMessagesTable } from "../table";

/**
 * @see specs/event-sourcing/simulation-run-aggregate.feature
 *
 * "subscribes to the two events that carry message content" and "produces no
 * row for a message that has only started" are bound in index.unit.test.ts,
 * against the built map's own `.eventTypes` and `.apply()` — this pipeline's
 * `.withMap(name, { on: {...} })` declaration is what the mount actually
 * dispatches on, not a standalone `map()` function.
 */

const RUN_ID = "run-1";

describe("the simulationRunMessages map handlers", () => {
  /** @scenario A redelivered message does not duplicate the run's transcript */
  it("re-derives the same row for a redelivered message", () => {
    const data = {
      scenarioRunId: RUN_ID,
      messageId: "m1",
      role: "assistant",
      content: "hi",
      messageIndex: 0,
      occurredAt: 10,
    };

    expect(mapTextMessageEnd(data)).toEqual(mapTextMessageEnd(data));
  });
});

describe("mapMessageSnapshot", () => {
  it("emits one record per message, numbered by its position", () => {
    const records = mapMessageSnapshot({
      scenarioRunId: RUN_ID,
      messages: [
        { id: "m1", role: "user", content: "hello", trace_id: "trace-1" },
        { id: "m2", role: "assistant", content: "hi" },
      ],
      traceIds: [],
      occurredAt: 1,
    });

    expect(records).toEqual([
      {
        scenarioRunId: RUN_ID,
        messageId: "m1",
        messageIndex: 0,
        role: "user",
        content: "hello",
        traceId: "trace-1",
        rest: "",
      },
      {
        scenarioRunId: RUN_ID,
        messageId: "m2",
        messageIndex: 1,
        role: "assistant",
        content: "hi",
        traceId: "",
        rest: "",
      },
    ]);
  });

  it("keys a message with no id of its own by its position", () => {
    const [record] = mapMessageSnapshot({
      scenarioRunId: RUN_ID,
      messages: [{ role: "user", content: "hello" }],
      traceIds: [],
      occurredAt: 1,
    });

    expect(record!.messageId).toBe("#0");
  });

  it("caps a message that carries inline media rather than storing it", () => {
    const [record] = mapMessageSnapshot({
      scenarioRunId: RUN_ID,
      messages: [{ id: "m1", role: "user", content: "x".repeat(200_000) }],
      traceIds: [],
      occurredAt: 1,
    });

    expect(record!.content).toMatch(/^\[truncated: 200000 bytes/);
  });

  it("keeps the AG-UI fields it has no column for as JSON", () => {
    const [record] = mapMessageSnapshot({
      scenarioRunId: RUN_ID,
      messages: [{ id: "m1", role: "user", content: "hi", toolCalls: ["a"] }],
      traceIds: [],
      occurredAt: 1,
    });

    expect(JSON.parse(record!.rest)).toEqual({ toolCalls: ["a"] });
  });

  it("emits a domain record, never the row the store writes", () => {
    const [record] = mapMessageSnapshot({
      scenarioRunId: RUN_ID,
      messages: [{ id: "m1", role: "user", content: "hi" }],
      traceIds: [],
      occurredAt: 1,
    });

    expect(Object.keys(record!)).toEqual(
      Object.keys(simulationMessageRecordSchema.shape),
    );
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
      scenarioRunId: RUN_ID,
      messageId: "m1",
      messageIndex: 3,
      role: "assistant",
      content: "hi",
      traceId: "trace-2",
      rest: "",
    });
  });
});

describe("the transcript's numbering", () => {
  /**
   * Both writers reach the same row for one message id, so which delivery
   * merged last cannot reorder the transcript.
   */
  it("gives one message the same index whether it arrived streamed or snapshotted", () => {
    const streamed = mapTextMessageEnd({
      scenarioRunId: RUN_ID,
      messageId: "m2",
      role: "assistant",
      content: "hi",
      messageIndex: 1,
      occurredAt: 10,
    });
    const [, snapshotted] = mapMessageSnapshot({
      scenarioRunId: RUN_ID,
      messages: [
        { id: "m1", role: "user", content: "hello" },
        { id: "m2", role: "assistant", content: "hi" },
      ],
      traceIds: [],
      occurredAt: 20,
    });

    expect(streamed.messageIndex).toBe(snapshotted!.messageIndex);
  });

  it("refuses a streamed message that numbers itself by default", () => {
    expect(() =>
      simulationRun.commands.endTextMessage.input.parse({
        scenarioRunId: RUN_ID,
        messageId: "m2",
        role: "assistant",
        content: "hi",
        occurredAt: 10,
      }),
    ).toThrow();
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
