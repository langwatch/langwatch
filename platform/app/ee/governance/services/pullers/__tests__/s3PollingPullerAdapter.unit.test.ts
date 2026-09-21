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
 * Spec: specs/governance/pulled-usage-cost-reporting.feature
 */
import { Readable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { S3PollingPullerAdapter } from "../s3PollingPullerAdapter";

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

let stubObjects: StubObject[] = [];
let lastListInvocation: {
  Prefix?: string;
  StartAfter?: string;
} | null = null;

beforeEach(() => {
  stubObjects = [];
  lastListInvocation = null;

  vi.doMock("@aws-sdk/client-s3", async () => {
    class FakeListCmd {
      constructor(
        public readonly input: { Prefix?: string; StartAfter?: string },
      ) {}
    }
    class FakeGetCmd {
      constructor(public readonly input: { Bucket: string; Key: string }) {}
    }
    class FakeS3Client {
      async send(cmd: FakeListCmd | FakeGetCmd) {
        if (cmd instanceof FakeListCmd) {
          lastListInvocation = cmd.input;
          const filtered = stubObjects.filter((o) => {
            if (cmd.input.Prefix && !o.key.startsWith(cmd.input.Prefix))
              return false;
            if (cmd.input.StartAfter && o.key <= cmd.input.StartAfter)
              return false;
            return true;
          });
          return {
            Contents: filtered.map((o) => ({ Key: o.key })),
            IsTruncated: false,
          };
        }
        if (cmd instanceof FakeGetCmd) {
          const obj = stubObjects.find((o) => o.key === cmd.input.Key);
          if (!obj) throw new Error(`stub: missing ${cmd.input.Key}`);
          return { Body: Readable.from([Buffer.from(obj.body, "utf-8")]) };
        }
        throw new Error("stub: unknown cmd");
      }
    }
    return {
      S3Client: FakeS3Client,
      ListObjectsV2Command: FakeListCmd,
      GetObjectCommand: FakeGetCmd,
    };
  });
});

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("S3PollingPullerAdapter", () => {
  describe("validateConfig", () => {
    it("accepts a valid config", () => {
      const adapter = new S3PollingPullerAdapter();
      expect(() => adapter.validateConfig(VALID_CONFIG)).not.toThrow();
    });

    it("rejects an unknown parser value", () => {
      const adapter = new S3PollingPullerAdapter();
      expect(() =>
        adapter.validateConfig({ ...VALID_CONFIG, parser: "yaml" }),
      ).toThrow();
    });

    it("rejects empty bucket name", () => {
      const adapter = new S3PollingPullerAdapter();
      expect(() =>
        adapter.validateConfig({ ...VALID_CONFIG, bucket: "" }),
      ).toThrow();
    });

    it("defaults prefix to empty string when omitted", () => {
      const adapter = new S3PollingPullerAdapter();
      const { prefix: _omit, ...withoutPrefix } = VALID_CONFIG;
      const parsed = adapter.validateConfig(withoutPrefix);
      expect(parsed.prefix).toBe("");
    });
  });

  describe("runOnce — ndjson parser", () => {
    it("happy-path drain: reads all keys lexicographically + advances cursor to last key", async () => {
      const { S3PollingPullerAdapter: AdapterUnderTest } = await import(
        "../s3PollingPullerAdapter"
      );
      const adapter = new AdapterUnderTest();
      stubObjects = [
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

      const result = await adapter.runOnce(
        { cursor: null },
        adapter.validateConfig(VALID_CONFIG),
      );

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
      const { S3PollingPullerAdapter: AdapterUnderTest } = await import(
        "../s3PollingPullerAdapter"
      );
      const adapter = new AdapterUnderTest();
      stubObjects = [
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

      expect(lastListInvocation?.StartAfter).toBe(
        "anthropic/compliance/2026-05-03-01.ndjson",
      );
      expect(result.cursor).toBe("anthropic/compliance/2026-05-03-02.ndjson");
      expect(result.events).toHaveLength(1);
    });

    it("returns empty result + cursor unchanged when no new keys", async () => {
      const { S3PollingPullerAdapter: AdapterUnderTest } = await import(
        "../s3PollingPullerAdapter"
      );
      const adapter = new AdapterUnderTest();
      // stubObjects empty
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
      const { S3PollingPullerAdapter: AdapterUnderTest } = await import(
        "../s3PollingPullerAdapter"
      );
      const adapter = new AdapterUnderTest();
      stubObjects = [
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
      const result = await adapter.runOnce(
        { cursor: null },
        adapter.validateConfig(VALID_CONFIG),
      );
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
      const { S3PollingPullerAdapter: AdapterUnderTest } = await import(
        "../s3PollingPullerAdapter"
      );
      const adapter = new AdapterUnderTest();
      stubObjects = [
        {
          key: "anthropic/compliance/worse.ndjson",
          body: "not-json\nalso-not-json\nstill-not-json",
        },
      ];
      const result = await adapter.runOnce(
        { cursor: null },
        adapter.validateConfig(VALID_CONFIG),
      );
      expect(result.events).toHaveLength(0);
      expect(result.errorCount).toBe(3);
      // A file that is entirely unreadable is the truncated-upload case. It
      // still advances, because re-pulling it forever is the failure this
      // whole path exists to avoid.
      expect(result.cursor).toBe("anthropic/compliance/worse.ndjson");
    });
  });

  describe("runOnce — a store holding more files than one run may read", () => {
    /** @scenario "A read of a stored log that stops at its file limit says it stopped early" */
    it("says it stopped before the end rather than reporting a whole read", async () => {
      const { S3PollingPullerAdapter: AdapterUnderTest } = await import(
        "../s3PollingPullerAdapter"
      );
      const adapter = new AdapterUnderTest();
      // One more object than the per-run file cap, so the listing is cut
      // short. The exact cap is the adapter's own business; what matters is
      // that a listing it truncated and a listing it drained leave through
      // the same exit today, so nothing above can tell a source stuck on a
      // fraction of its bucket from a healthy one.
      stubObjects = Array.from({ length: 101 }, (_, at) => ({
        key: `anthropic/compliance/2026-01-15-${String(at).padStart(4, "0")}.ndjson`,
        body: JSON.stringify({
          id: `e${at}`,
          timestamp: "2026-01-15T00:00:00Z",
          user_email: "a@x",
          event: "completion",
          model: "m",
          cost: 0.001,
          tokens_in: 10,
          tokens_out: 5,
        }),
      }));

      const result = await adapter.runOnce(
        { cursor: null },
        adapter.validateConfig(VALID_CONFIG),
      );

      // Not yet implemented: PullResult.completeness (the run port field the
      // truncation settlement adds). Field not yet on the port (held by PR
      // #8043 work), so it is read off a widened view of the result here.
      const reported = result as typeof result & {
        completeness?: "complete" | "truncated";
      };
      expect(reported.completeness).toBe("truncated");
      // The money and the audit rows it did read are still handed back — a
      // truncated read is not a failed one.
      expect(result.errorCount).toBe(0);
      expect(result.events.length).toBeGreaterThan(0);
    });

    /** @scenario "A read of a stored log that stops at its file limit says it stopped early" */
    it("says it read the store whole when the listing fits inside the limit", async () => {
      // The arm from the far side: without it the assertion above passes on
      // an adapter that reports every run as truncated.
      const { S3PollingPullerAdapter: AdapterUnderTest } = await import(
        "../s3PollingPullerAdapter"
      );
      const adapter = new AdapterUnderTest();
      stubObjects = [
        {
          key: "anthropic/compliance/2026-01-15-0000.ndjson",
          body: JSON.stringify({
            id: "e1",
            timestamp: "2026-01-15T00:00:00Z",
            user_email: "a@x",
            event: "completion",
            model: "m",
            cost: 0.001,
            tokens_in: 10,
            tokens_out: 5,
          }),
        },
      ];

      const result = await adapter.runOnce(
        { cursor: null },
        adapter.validateConfig(VALID_CONFIG),
      );

      const reported = result as typeof result & {
        completeness?: "complete" | "truncated";
      };
      expect(reported.completeness).toBe("complete");
    });
  });

  describe("runOnce — json-array parser", () => {
    it("parses a top-level array into events", async () => {
      const { S3PollingPullerAdapter: AdapterUnderTest } = await import(
        "../s3PollingPullerAdapter"
      );
      const adapter = new AdapterUnderTest();
      stubObjects = [
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
      const { S3PollingPullerAdapter: AdapterUnderTest } = await import(
        "../s3PollingPullerAdapter"
      );
      const adapter = new AdapterUnderTest();
      stubObjects = [
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
