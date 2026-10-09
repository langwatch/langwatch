/**
 * The stored-event parse report: refusals grouped with a count and one example id, and an
 * undeclared type named, without a ClickHouse target.
 * @see packages/eventing/specs/stored-event-parse.feature
 */
import { describe, expect, it } from "vitest";

import {
  findRefusedGroups,
  formatRefusedGroups,
  type ParserFor,
  type StoredEventGroup,
  type StoredEventRow,
  type StoredEventSource,
} from "./stored-events-parse.ts";

/** A schema refusal shaped as Zod reports one: issue paths and codes, values beside them. */
function parseKnown(value: unknown): unknown {
  const name =
    typeof value === "object" && value !== null && "data" in value ? value.data : undefined;
  if (
    typeof name === "object" &&
    name !== null &&
    "name" in name &&
    typeof name.name === "string"
  ) {
    return value;
  }
  throw Object.assign(new Error("invalid"), {
    issues: [{ path: ["data", "name"], code: "invalid_type", input: name }],
  });
}

const parserFor: ParserFor = (eventType) =>
  eventType === "known.created" ? parseKnown : undefined;

function row({
  id,
  type,
  payload,
}: {
  id: string;
  type: string;
  payload: unknown;
}): StoredEventRow {
  return {
    TenantId: "tenant-1",
    AggregateType: "known",
    AggregateId: "aggregate-1",
    EventId: id,
    EventTimestamp: 1_700_000_000_000,
    EventOccurredAt: null,
    EventType: type,
    EventVersion: "2026-01-01",
    EventPayload: payload,
    ProcessingTraceparent: "",
    IdempotencyKey: "",
  };
}

function memorySource(rows: readonly StoredEventRow[]): StoredEventSource {
  const groupOf = (stored: StoredEventRow) =>
    `${stored.AggregateType}|${stored.EventType}|${stored.EventVersion}`;
  return {
    async countGroups() {
      const groups = new Map<string, StoredEventGroup>();
      for (const stored of rows) {
        const known = groups.get(groupOf(stored));
        groups.set(groupOf(stored), {
          aggregateType: stored.AggregateType,
          eventType: stored.EventType,
          eventVersion: stored.EventVersion,
          stored: (known?.stored ?? 0) + 1,
        });
      }
      return [...groups.values()];
    },
    async *readGroup({ group, limit }) {
      yield rows
        .filter(
          (stored) =>
            groupOf(stored) === `${group.aggregateType}|${group.eventType}|${group.eventVersion}`,
        )
        .slice(0, limit);
    },
  };
}

describe("findRefusedGroups", () => {
  /** @scenario "A planted unknown event type is named" */
  it("names a planted unknown type as undeclared, with its count", async () => {
    const source = memorySource([
      row({ id: "e1", type: "known.created", payload: { name: "a" } }),
      row({ id: "e2", type: "planted.unknown", payload: { secret: "never printed" } }),
      row({ id: "e3", type: "planted.unknown", payload: {} }),
    ]);

    const refused = await findRefusedGroups({
      target: "shared",
      source,
      parserFor,
      sampleSize: 100,
    });

    expect(refused).toEqual([
      expect.objectContaining({
        target: "shared",
        eventType: "planted.unknown",
        reason: "undeclared",
        refused: 2,
        stored: 2,
        exampleEventId: "e2",
      }),
    ]);
    expect(formatRefusedGroups(refused)).not.toContain("never printed");
  });

  /** @scenario "A refusal is reported by group with its count and one example event id" */
  it("reports schema refusals by group with a count, an example id and issue paths only", async () => {
    const source = memorySource([
      row({ id: "e1", type: "known.created", payload: { name: "a" } }),
      row({ id: "e2", type: "known.created", payload: { name: 42 } }),
      row({ id: "e3", type: "known.created", payload: { name: 43 } }),
    ]);

    const refused = await findRefusedGroups({
      target: "private",
      source,
      parserFor,
      sampleSize: 100,
    });

    expect(refused[0]).toMatchObject({
      target: "private",
      aggregateType: "known",
      eventVersion: "2026-01-01",
      reason: "refused",
      refused: 2,
      sampled: 3,
      exampleEventId: "e2",
      issues: ["data.name:invalid_type"],
    });
    expect(formatRefusedGroups(refused)).not.toContain("42");
  });

  it("parses no more than the sample of a large group", async () => {
    const rows = Array.from({ length: 50 }, (_, index) =>
      row({ id: `e${index}`, type: "known.created", payload: {} }),
    );

    const refused = await findRefusedGroups({
      target: "shared",
      source: memorySource(rows),
      parserFor,
      sampleSize: 10,
    });

    expect(refused[0]).toMatchObject({ sampled: 10, refused: 10, stored: 50 });
  });
});
