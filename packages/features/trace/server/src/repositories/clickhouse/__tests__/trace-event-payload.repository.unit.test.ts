import { Ksuid, generate } from "@langwatch/ksuid";
import { describe, expect, it } from "vitest";
import { TraceClickHousePort, type TraceClickHouseClient } from "../../../ports/clickhouse.port";
import {
  ClickHouseTraceEventPayloadRepository,
  TraceEventPayloadFieldNotFoundError,
  TraceEventPayloadNotFoundError,
} from "../trace-event-payload.repository";

type Query = { query: string; query_params?: Record<string, unknown> };

class RecordingClickHouse extends TraceClickHousePort {
  readonly queries: Query[] = [];
  rows: unknown[] = [];

  async resolve(_tenantId: string): Promise<TraceClickHouseClient> {
    const capture = (input: Query): void => void this.queries.push(input);
    const rows = (): unknown[] => this.rows;
    return {
      async query<Row>(input: {
        query: string;
        query_params?: Record<string, unknown>;
        format: "JSONEachRow";
      }): Promise<{ json<T = Row>(): Promise<T[]> }> {
        capture(input);
        return { json: async <T>(): Promise<T[]> => rows() as T[] };
      },
    };
  }
}

/** A KSUID whose embedded creation time the window is derived from. */
const EVENT_ID = generate("evt").toString();
const EVENT_TIME_MS = Ksuid.parse(EVENT_ID).date.getTime();
const WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

function payload(body: unknown): unknown[] {
  return [{ EventPayload: JSON.stringify(body) }];
}

describe("ClickHouseTraceEventPayloadRepository", () => {
  const read = async (
    clickhouse: RecordingClickHouse,
    overrides: Partial<{ eventId: string; field: string }> = {},
  ): Promise<string> =>
    ClickHouseTraceEventPayloadRepository.create(clickhouse).getField({
      eventId: overrides.eventId ?? EVENT_ID,
      field: overrides.field ?? "langwatch.input",
      tenantId: "tenant-1",
      aggregateType: "trace",
      aggregateId: "trace-1",
    });

  describe("given an offloaded span attribute", () => {
    describe("when it is recalled", () => {
      /** @scenario "The event log read names the tenant first" */
      it("filters on tenant before any other predicate", async () => {
        const clickhouse = new RecordingClickHouse();
        clickhouse.rows = payload({
          span: { attributes: [{ key: "langwatch.input", value: { stringValue: "hello" } }] },
        });

        await read(clickhouse);

        const sql = clickhouse.queries[0]!.query.replace(/\s+/g, " ").trim();
        expect(sql).toContain(
          "WHERE TenantId = {tenantId:String} AND AggregateType = {aggregateType:String} " +
            "AND AggregateId = {aggregateId:String} AND EventId = {eventId:String}",
        );
        expect(sql).toContain("SELECT EventPayload FROM event_log");
        expect(sql).toContain("LIMIT 1");
      });

      /** @scenario "The partition window is derived from the event id itself" */
      it("prunes to a two-day window around the id's own creation time", async () => {
        const clickhouse = new RecordingClickHouse();
        clickhouse.rows = payload({
          span: { attributes: [{ key: "langwatch.input", value: { stringValue: "hello" } }] },
        });

        await read(clickhouse);

        expect(clickhouse.queries[0]!.query_params).toEqual({
          tenantId: "tenant-1",
          aggregateType: "trace",
          aggregateId: "trace-1",
          eventId: EVENT_ID,
          occurredAtFromMs: EVENT_TIME_MS - WINDOW_MS,
          occurredAtToMs: EVENT_TIME_MS + WINDOW_MS,
        });
      });

      /** @scenario "A row with no recorded occurred time is never pruned away" */
      it("keeps rows whose occurred time is the column default", async () => {
        const clickhouse = new RecordingClickHouse();
        clickhouse.rows = payload({
          span: { attributes: [{ key: "langwatch.input", value: { stringValue: "hello" } }] },
        });

        await read(clickhouse);

        expect(clickhouse.queries[0]!.query.replace(/\s+/g, " ")).toContain(
          "AND ( EventOccurredAt = 0 OR ( EventOccurredAt >= {occurredAtFromMs:UInt64} " +
            "AND EventOccurredAt <= {occurredAtToMs:UInt64} ) )",
        );
      });

      /** @scenario "A malformed sibling attribute cannot mask the offloaded field" */
      it("returns the offloaded value past a numeric sibling attribute", async () => {
        const clickhouse = new RecordingClickHouse();
        clickhouse.rows = payload({
          span: {
            attributes: [
              { key: "gen_ai.usage.input_tokens", value: { intValue: "100" } },
              "not an attribute at all",
              { key: "langwatch.input", value: { stringValue: "hello" } },
            ],
          },
        });

        await expect(read(clickhouse)).resolves.toBe("hello");
      });
    });
  });

  describe("given an event id that is not a KSUID", () => {
    describe("when the field is recalled", () => {
      /** @scenario "An unparseable event id falls back to an unpruned read" */
      it("applies no occurred-time predicate at all", async () => {
        const clickhouse = new RecordingClickHouse();
        clickhouse.rows = payload({
          span: { attributes: [{ key: "langwatch.input", value: { stringValue: "hello" } }] },
        });

        await read(clickhouse, { eventId: "not-a-ksuid" });

        expect(clickhouse.queries[0]!.query).not.toContain("EventOccurredAt");
        expect(clickhouse.queries[0]!.query_params).toEqual({
          tenantId: "tenant-1",
          aggregateType: "trace",
          aggregateId: "trace-1",
          eventId: "not-a-ksuid",
        });
      });
    });
  });

  describe("given a log record whose body was offloaded", () => {
    describe("when the body field is recalled", () => {
      /** @scenario "A log record's body is recalled from the top of the payload" */
      it("reads it from the payload root rather than from span attributes", async () => {
        const clickhouse = new RecordingClickHouse();
        clickhouse.rows = payload({ body: "the whole log line" });

        await expect(read(clickhouse, { field: "body" })).resolves.toBe("the whole log line");
      });
    });
  });

  describe("given the row is absent", () => {
    describe("when the field is recalled", () => {
      /** @scenario "Absence answers null rather than raising at the read port" */
      it("raises not-found rather than answering an empty value", async () => {
        const clickhouse = new RecordingClickHouse();
        clickhouse.rows = [];

        await expect(read(clickhouse)).rejects.toBeInstanceOf(TraceEventPayloadNotFoundError);
      });
    });
  });

  describe("given the payload carries no such field", () => {
    describe("when the field is recalled", () => {
      /** @scenario "Absence answers null rather than raising at the read port" */
      it("raises field-not-found", async () => {
        const clickhouse = new RecordingClickHouse();
        clickhouse.rows = payload({ span: { attributes: [] } });

        await expect(read(clickhouse)).rejects.toBeInstanceOf(TraceEventPayloadFieldNotFoundError);
      });
    });
  });

  describe("given the stored payload is not JSON", () => {
    describe("when the field is recalled", () => {
      it("names the event it could not parse", async () => {
        const clickhouse = new RecordingClickHouse();
        clickhouse.rows = [{ EventPayload: "{not json" }];

        await expect(read(clickhouse)).rejects.toThrow(
          new RegExp(`Failed to parse EventPayload for eventId=${EVENT_ID}`),
        );
      });
    });
  });
});
