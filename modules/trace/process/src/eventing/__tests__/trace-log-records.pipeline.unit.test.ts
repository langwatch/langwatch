/**
 * @vitest-environment node
 * Trace maps log's record fact into its own stored_log_records, so it keeps no log peer.
 * Spec: modules/trace/specs/trace-log-record-storage.feature
 */
import { describe, expect, it, vi } from "vitest";

import { TRACE_LOG_RECORD_STORAGE_LANE } from "../trace-log-records.pipeline.ts";
import { canonicalLogRecordFixture, logRecordsHarness } from "./trace-log-records.fixtures.ts";

describe("given trace's log record lane beside log's record fact", () => {
  it("hosts one peer map lane, named for replay", () => {
    const { host } = logRecordsHarness();
    expect(host.globalProjections?.map((lane) => [lane.name, lane.peer?.kind])).toEqual([
      [TRACE_LOG_RECORD_STORAGE_LANE, "map"],
    ]);
  });

  describe("when log records a record correlated to a trace and a span", () => {
    /** @scenario "Trace maps a trace-correlated log record into its own stored log records" */
    it("stores it in log's trace read shape, keyed by its record id, at the tenant's retention", async () => {
      const { eventing, record, repository } = logRecordsHarness();

      await record(canonicalLogRecordFixture(), "event-1");

      await vi.waitFor(() => expect(repository.storedRows()).toHaveLength(1));
      expect(repository.storedRows()[0]).toMatchObject({
        tenantId: "project-1",
        recordId: "a".repeat(64),
        retentionDays: 400,
      });
      await expect(
        repository.findLogsByTraceId({ tenantId: "project-1", traceId: "trace-1" }),
      ).resolves.toEqual([
        {
          traceId: "trace-1",
          spanId: "span-1",
          timeUnixMs: 1_700_000_000_000,
          body: "hello",
          attributes: { "prompt.id": "prompt-1", "event.name": "claude_code.user_prompt" },
          resourceAttributes: { "service.name": "claude-code" },
          scopeName: "com.anthropic.claude_code",
          scopeVersion: "1.0.0",
        },
      ]);
      await eventing.close();
    });
  });

  describe("when log records a record with no correlated trace", () => {
    /** @scenario "A log record that names no trace is not stored by trace" */
    it("stores nothing", async () => {
      const { eventing, record, repository } = logRecordsHarness();

      await record(
        canonicalLogRecordFixture({
          recordId: "b".repeat(64),
          correlationTraceId: "",
          correlationSpanId: "",
        }),
        "event-uncorrelated",
      );
      await record(canonicalLogRecordFixture({ recordId: "c".repeat(64) }), "event-correlated");

      await vi.waitFor(() => expect(repository.storedRows()).toHaveLength(1));
      expect(repository.storedRows()[0]?.recordId).toBe("c".repeat(64));
      await eventing.close();
    });
  });
});
