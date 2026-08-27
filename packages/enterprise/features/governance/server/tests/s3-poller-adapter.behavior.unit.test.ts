/**
 * Unit coverage for S3PollingPullerAdapter — exercises:
 *   - validateConfig accepting/rejecting shapes
 *   - parser modes (ndjson / json-array / csv)
 *   - cursor advance to lexicographic-max key
 *   - StartAfter respected on cursor resume
 *   - empty list returns drained cursor unchanged
 *   - malformed ndjson lines skipped + errorCount increments
 *
 * Hits a stubbed S3 client (no real AWS) so the test can exercise
 * the parser/cursor/error paths without testcontainers.
 *
 * Spec: specs/ai-governance/puller-framework/s3-polling.feature
 */
import { beforeEach, describe, expect, it } from "vitest";

import { S3PollingPullerAdapter } from "../src/adapters/s3-puller.adapter";
import { TestObjectStoragePort } from "./support/puller-test-ports";

const VALID_CONFIG = {
  adapter: "s3_polling" as const,
  bucket: "acme-audit",
  prefix: "anthropic/compliance/",
  region: "us-east-1",
  parser: "ndjson" as const,
  schedule: "0 * * * *",
  eventMapping: {
    source_event_id: "$.id",
    event_timestamp: "$.timestamp",
    actor: "$.user_email",
    action: "$.event",
    target: "$.model",
    cost_usd: "$.cost",
    tokens_input: "$.tokens_in",
    tokens_output: "$.tokens_out",
  },
};

interface StubObject {
  key: string;
  body: string;
}

let storage: TestObjectStoragePort;

function makeAdapter(): S3PollingPullerAdapter {
  return S3PollingPullerAdapter.create({ objects: storage });
}

beforeEach(() => {
  storage = new TestObjectStoragePort();
});

describe("S3PollingPullerAdapter", () => {
  describe("validateConfig", () => {
    it("accepts a valid config", () => {
      const adapter = makeAdapter();
      expect(() => adapter.validateConfig(VALID_CONFIG)).not.toThrow();
    });

    it("rejects an unknown parser value", () => {
      const adapter = makeAdapter();
      expect(() => adapter.validateConfig({ ...VALID_CONFIG, parser: "yaml" })).toThrow();
    });

    it("rejects empty bucket name", () => {
      const adapter = makeAdapter();
      expect(() => adapter.validateConfig({ ...VALID_CONFIG, bucket: "" })).toThrow();
    });

    it("defaults prefix to empty string when omitted", () => {
      const adapter = makeAdapter();
      const { prefix: _omit, ...withoutPrefix } = VALID_CONFIG;
      const parsed = adapter.validateConfig(withoutPrefix);
      expect(parsed.prefix).toBe("");
    });
  });

  describe("runOnce — ndjson parser", () => {
    it("happy-path drain: reads all keys lexicographically + advances cursor to last key", async () => {
      const adapter = makeAdapter();
      storage.objects = [
        {
          key: "anthropic/compliance/2026-05-03-00.ndjson",
          body: JSON.stringify({
            id: "e1",
            timestamp: "2026-05-03T00:00:00Z",
            user_email: "a@x",
            event: "completion",
            model: "m",
            cost: 0.001,
            tokens_in: 10,
            tokens_out: 5,
          }),
        },
        {
          key: "anthropic/compliance/2026-05-03-01.ndjson",
          body:
            JSON.stringify({
              id: "e2",
              timestamp: "2026-05-03T01:00:00Z",
              user_email: "b@x",
              event: "completion",
              model: "m",
              cost: 0.002,
              tokens_in: 20,
              tokens_out: 8,
            }) +
            "\n" +
            JSON.stringify({
              id: "e3",
              timestamp: "2026-05-03T01:01:00Z",
              user_email: "c@x",
              event: "completion",
              model: "m",
              cost: 0.003,
              tokens_in: 30,
              tokens_out: 12,
            }),
        },
      ];

      const result = await adapter.runOnce({ cursor: null }, adapter.validateConfig(VALID_CONFIG));

      expect(result.errorCount).toBe(0);
      expect(result.cursor).toBe("anthropic/compliance/2026-05-03-01.ndjson");
      expect(result.events).toHaveLength(3);
      expect(result.events[0]).toMatchObject({
        source_event_id: "e1",
        actor: "a@x",
      });
      expect(result.events[2]).toMatchObject({
        source_event_id: "e3",
        cost_usd: "0.003",
      });
    });

    it("respects cursor: passes StartAfter to ListObjectsV2 + skips already-seen keys", async () => {
      const adapter = makeAdapter();
      storage.objects = [
        {
          key: "anthropic/compliance/2026-05-03-02.ndjson",
          body: JSON.stringify({
            id: "e4",
            timestamp: "2026-05-03T02:00:00Z",
            user_email: "d@x",
            event: "completion",
            model: "m",
            cost: 0,
            tokens_in: 0,
            tokens_out: 0,
          }),
        },
      ];

      const result = await adapter.runOnce(
        { cursor: "anthropic/compliance/2026-05-03-01.ndjson" },
        adapter.validateConfig(VALID_CONFIG),
      );

      expect(storage.lastList?.startAfter).toBe("anthropic/compliance/2026-05-03-01.ndjson");
      expect(result.cursor).toBe("anthropic/compliance/2026-05-03-02.ndjson");
      expect(result.events).toHaveLength(1);
    });

    it("returns empty result + cursor unchanged when no new keys", async () => {
      const adapter = makeAdapter();
      // storage.objects empty
      const result = await adapter.runOnce(
        { cursor: "anthropic/compliance/2026-05-03-99.ndjson" },
        adapter.validateConfig(VALID_CONFIG),
      );
      expect(result.events).toHaveLength(0);
      expect(result.cursor).toBe("anthropic/compliance/2026-05-03-99.ndjson");
      expect(result.errorCount).toBe(0);
    });

    /** @scenario "Malformed file skipped, run continues" */
    it("skips malformed ndjson lines without aborting; cursor still advances", async () => {
      const adapter = makeAdapter();
      storage.objects = [
        {
          key: "anthropic/compliance/bad.ndjson",
          body:
            JSON.stringify({
              id: "ok-1",
              timestamp: "2026-05-03T00:00:00Z",
              user_email: "x",
              event: "e",
              model: "m",
              cost: 0,
              tokens_in: 0,
              tokens_out: 0,
            }) +
            "\nthis-is-not-json\n" +
            JSON.stringify({
              id: "ok-2",
              timestamp: "2026-05-03T00:01:00Z",
              user_email: "y",
              event: "e",
              model: "m",
              cost: 0,
              tokens_in: 0,
              tokens_out: 0,
            }),
        },
      ];
      const result = await adapter.runOnce({ cursor: null }, adapter.validateConfig(VALID_CONFIG));
      expect(result.events).toHaveLength(2);
      expect(result.cursor).toBe("anthropic/compliance/bad.ndjson");
      // This assertion used to read `toBe(0)`, with a comment explaining that
      // the parser absorbed malformed lines without surfacing them. That was
      // the defect, written down as the expectation: a bad line was dropped in
      // silence while the cursor advanced past the file, so nothing was ever
      // alerted about corrupt input. The spec says errorCount reflects the
      // number of bad lines seen, and now it does.
      expect(result.errorCount).toBe(1);
    });

    /** @scenario "Malformed file skipped, run continues" */
    it("counts every unreadable line, not just the first", async () => {
      const adapter = makeAdapter();
      storage.objects = [
        {
          key: "anthropic/compliance/worse.ndjson",
          body: "not-json\nalso-not-json\nstill-not-json",
        },
      ];
      const result = await adapter.runOnce({ cursor: null }, adapter.validateConfig(VALID_CONFIG));
      expect(result.events).toHaveLength(0);
      expect(result.errorCount).toBe(3);
      // A file that is entirely unreadable is the truncated-upload case. It
      // still advances, because re-pulling it forever is the failure this
      // whole path exists to avoid.
      expect(result.cursor).toBe("anthropic/compliance/worse.ndjson");
    });
  });

  describe("runOnce — json-array parser", () => {
    it("parses a top-level array into events", async () => {
      const adapter = makeAdapter();
      storage.objects = [
        {
          key: "anthropic/compliance/array.json",
          body: JSON.stringify([
            {
              id: "a1",
              timestamp: "2026-05-03T00:00:00Z",
              user_email: "u",
              event: "e",
              model: "m",
              cost: 0,
              tokens_in: 0,
              tokens_out: 0,
            },
            {
              id: "a2",
              timestamp: "2026-05-03T00:01:00Z",
              user_email: "v",
              event: "e",
              model: "m",
              cost: 0,
              tokens_in: 0,
              tokens_out: 0,
            },
          ]),
        },
      ];
      const result = await adapter.runOnce(
        { cursor: null },
        adapter.validateConfig({ ...VALID_CONFIG, parser: "json-array" }),
      );
      expect(result.events).toHaveLength(2);
      expect(result.events[0]!.source_event_id).toBe("a1");
    });
  });

  describe("runOnce — csv parser", () => {
    it("parses headers + 3 data rows", async () => {
      const adapter = makeAdapter();
      storage.objects = [
        {
          key: "anthropic/compliance/data.csv",
          body:
            "id,timestamp,user_email,event,model,cost,tokens_in,tokens_out\n" +
            "c1,2026-05-03T00:00:00Z,csv-1@x,completion,m,0,0,0\n" +
            "c2,2026-05-03T00:01:00Z,csv-2@x,completion,m,0,0,0\n" +
            "c3,2026-05-03T00:02:00Z,csv-3@x,completion,m,0,0,0\n",
        },
      ];
      const result = await adapter.runOnce(
        { cursor: null },
        adapter.validateConfig({ ...VALID_CONFIG, parser: "csv" }),
      );
      expect(result.events).toHaveLength(3);
      expect(result.events[0]!.actor).toBe("csv-1@x");
      expect(result.events[2]!.source_event_id).toBe("c3");
    });
  });
});
