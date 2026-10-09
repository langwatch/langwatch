/**
 * After an upgrade, every event in each ClickHouse target's `event_log` parses under the worker's
 * installed pipelines and their upcasts (soak S14, invariant I7). The upgrade harness runs it after
 * settle with STORED_EVENTS_CLICKHOUSE_URLS; STORED_EVENTS_REPORT receives the JSON table.
 * @see packages/eventing/specs/stored-event-parse.feature
 */
import { writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  findRefusedGroups,
  formatRefusedGroups,
  parserFromDefinitions,
  type RefusedGroup,
  type StoredEventGroup,
  type StoredEventRow,
  type StoredEventSource,
} from "./support/stored-events-parse.ts";
import { bootMemoryWorker } from "./worker-memory-boot.fixture.ts";

const TARGETS = (process.env.STORED_EVENTS_CLICKHOUSE_URLS ?? "")
  .split(",")
  .map((url) => url.trim())
  .filter((url) => url !== "");
const REPORT = process.env.STORED_EVENTS_REPORT;
const SAMPLE_SIZE = Number(process.env.STORED_EVENTS_SAMPLE_SIZE ?? "2000");
const BATCH_SIZE = 500;

/** A target over ClickHouse's HTTP interface; credentials travel as headers, never in a log. */
function httpSource(raw: string): StoredEventSource {
  const url = new URL(raw);
  const endpoint = `${url.protocol}//${url.host}/`;
  const headers = {
    "X-ClickHouse-User": decodeURIComponent(url.username) || "default",
    "X-ClickHouse-Key": decodeURIComponent(url.password),
    "X-ClickHouse-Database": url.pathname.replace(/^\//, "") || "default",
  };
  const post = async (sql: string, params: Record<string, string>) => {
    const search = new URLSearchParams({
      default_format: "JSONEachRow",
      output_format_json_quote_64bit_integers: "0",
      ...Object.fromEntries(Object.entries(params).map(([key, value]) => [`param_${key}`, value])),
    });
    const response = await fetch(`${endpoint}?${search}`, { method: "POST", headers, body: sql });
    if (!response.ok || !response.body) {
      throw new Error(
        `ClickHouse ${url.host} answered ${response.status}: ${await response.text()}`,
      );
    }
    return response.body;
  };
  async function* lines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
    let buffered = "";
    for await (const chunk of body.pipeThrough(new TextDecoderStream())) {
      buffered += chunk;
      const parts = buffered.split("\n");
      buffered = parts.pop() ?? "";
      yield* parts.filter((line) => line !== "");
    }
    if (buffered !== "") yield buffered;
  }
  return {
    async countGroups() {
      const body = await post(
        `SELECT AggregateType AS aggregateType, EventType AS eventType, EventVersion AS eventVersion,
                count() AS stored
         FROM event_log GROUP BY AggregateType, EventType, EventVersion`,
        {},
      );
      const groups: StoredEventGroup[] = [];
      for await (const line of lines(body)) groups.push(JSON.parse(line));
      return groups;
    },
    async *readGroup({ group, limit }) {
      const body = await post(
        `SELECT TenantId, AggregateType, AggregateId, EventId, EventTimestamp, EventOccurredAt,
                EventType, EventVersion, EventPayload, ProcessingTraceparent, IdempotencyKey
         FROM event_log
         WHERE AggregateType = {aggregateType:String} AND EventType = {eventType:String}
           AND EventVersion = {eventVersion:String}
         LIMIT {limit:UInt32}`,
        {
          aggregateType: group.aggregateType,
          eventType: group.eventType,
          eventVersion: group.eventVersion,
          limit: String(limit),
        },
      );
      let batch: StoredEventRow[] = [];
      for await (const line of lines(body)) {
        batch.push(JSON.parse(line));
        if (batch.length >= BATCH_SIZE) {
          yield batch;
          batch = [];
        }
      }
      if (batch.length > 0) yield batch;
    },
  };
}

describe("stored events parse after an upgrade", () => {
  /** @scenario "The check skips with a reason when no target is given" */
  /** @scenario "Every stored event of a settled upgrade parses" */
  /** @scenario "Events are read by group, in bounded batches" */
  /** @scenario "Private ClickHouse targets are read too" */
  /** @scenario "The report is written for the upgrade harness" */
  it.skipIf(TARGETS.length === 0)(
    "refuses no stored event on any target (skipped: STORED_EVENTS_CLICKHOUSE_URLS is unset)",
    async () => {
      const { runtime, eventing } = await bootMemoryWorker();
      try {
        const parserFor = parserFromDefinitions(eventing.definitions);
        const refused: RefusedGroup[] = [];
        for (const [index, raw] of TARGETS.entries()) {
          const target = `target-${index}:${new URL(raw).host}`;
          refused.push(
            ...(await findRefusedGroups({
              target,
              source: httpSource(raw),
              parserFor,
              sampleSize: SAMPLE_SIZE,
            })),
          );
        }
        if (REPORT)
          writeFileSync(REPORT, JSON.stringify({ targets: TARGETS.length, refused }, null, 2));
        expect(refused, `refused stored events:\n${formatRefusedGroups(refused)}`).toEqual([]);
      } finally {
        await runtime.stop();
      }
    },
    1_800_000,
  );
});
