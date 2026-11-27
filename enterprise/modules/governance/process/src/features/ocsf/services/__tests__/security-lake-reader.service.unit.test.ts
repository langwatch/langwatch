/** Spec: enterprise/modules/governance/specs/security-lake-ingest.feature */
import {
  OCSF_INGEST_MAX_FUTURE_MS,
  type SecurityLakePullConfig,
  securityLakePullConfigSchema,
} from "@langwatch/enterprise-governance-contract";
import { parquetWriteBuffer } from "hyparquet-writer";
import { describe, expect, it } from "vitest";

import { MemoryObjectStoreChannel } from "../../../../channels/memory/memory.object-store.channel.ts";
import { MemorySecurityLakeQueueChannel } from "../../../../channels/memory/memory.security-lake-queue.channel.ts";
import type { GovernanceObjectStore } from "../../../../channels/object-store.channel.ts";
import type {
  GovernanceOcsfEvent,
  GovernanceOcsfEventSink,
} from "../../../../repositories/governance.repositories.ts";
import { MemoryOcsfEventsRepository } from "../../../../repositories/memory/memory.ocsf-events.repository.ts";
import type { SecurityLakeDecodeLimits } from "../../rules/security-lake-parquet.rules.ts";
import {
  SecurityLakeReaderService,
  type SecurityLakeRunBudget,
} from "../security-lake-reader.service.ts";

const TENANT = "project_governance";
const SOURCE = "source_lake";
const BUCKET = "aws-security-data-lake-eu-west-1-acme";
const PRINCIPAL = "arn:aws:iam::123456789012:role/acme-support-agent";
const MGMT_KEY = "aws/CLOUD_TRAIL_MGMT/2.0/region=eu-west-1/accountId=123456789012/a.parquet";
const DATA_KEY = "aws/S3_DATA/2.0/region=eu-west-1/accountId=123456789012/b.parquet";
const NOW_MS = 1_763_300_000_000;

type CloudTrailCall = {
  uid: string | null;
  service: string;
  operation: string;
  modelId?: string;
};

/** A CloudTrail OCSF 1.1 API Activity file shaped like the ones Security Lake writes. */
function cloudTrailParquet(
  calls: CloudTrailCall[],
  { rowGroupSize }: { rowGroupSize?: number } = {},
): Uint8Array {
  const buffer = parquetWriteBuffer({
    ...(rowGroupSize === undefined ? {} : { rowGroupSize }),
    columnData: [
      { name: "class_uid", data: calls.map(() => 6003), type: "INT32" },
      { name: "category_uid", data: calls.map(() => 6), type: "INT32" },
      { name: "activity_id", data: calls.map(() => 99), type: "INT32" },
      { name: "severity_id", data: calls.map(() => 1), type: "INT32" },
      { name: "time", data: calls.map((_, i) => BigInt(NOW_MS + i * 1000)), type: "INT64" },
      { name: "metadata", data: calls.map((call) => ({ uid: call.uid, version: "1.1.0" })) },
      {
        name: "api",
        data: calls.map((call) => ({
          operation: call.operation,
          service: { name: call.service },
          request: { data: call.modelId ? JSON.stringify({ modelId: call.modelId }) : null },
        })),
      },
      { name: "actor", data: calls.map(() => ({ user: { uid: PRINCIPAL, type: "AssumedRole" } })) },
      { name: "cloud", data: calls.map(() => ({ region: "eu-west-1", provider: "AWS" })) },
    ],
  });
  return new Uint8Array(buffer);
}

function notification(key: string): string {
  return JSON.stringify({
    "detail-type": "Object Created",
    source: "aws.s3",
    detail: { bucket: { name: BUCKET }, object: { key } },
  });
}

const MIXED_CALLS: CloudTrailCall[] = [
  {
    uid: "ct-1",
    service: "bedrock.amazonaws.com",
    operation: "InvokeModel",
    modelId: "anthropic.claude-sonnet-5-5",
  },
  {
    uid: "ct-2",
    service: "bedrock.amazonaws.com",
    operation: "Converse",
    modelId: "amazon.nova-pro-v1:0",
  },
  { uid: "ct-3", service: "s3.amazonaws.com", operation: "GetObject" },
];

function setup({
  config = {},
  events,
  decodeLimits,
  runBudget,
  onRead,
}: {
  config?: Partial<SecurityLakePullConfig>;
  events?: GovernanceOcsfEventSink;
  decodeLimits?: SecurityLakeDecodeLimits;
  runBudget?: SecurityLakeRunBudget;
  /** Runs before each object read, as a slow read or a competing reader would. */
  onRead?: (key: string) => Promise<void> | void;
} = {}) {
  const clock = { ms: NOW_MS };
  const now = () => clock.ms;
  const queue = MemorySecurityLakeQueueChannel.create({ visibilityTimeoutMs: 30_000, now });
  const objects = MemoryObjectStoreChannel.create();
  const store = MemoryOcsfEventsRepository.create();
  const readBytes = objects.readBytes.bind(objects);
  const fetched: string[] = [];
  const observed: GovernanceObjectStore = {
    list: (input) => objects.list(input),
    readText: (input) => objects.readText(input),
    readBytes: async (input) => {
      fetched.push(input.key);
      await onRead?.(input.key);
      return readBytes(input);
    },
  };
  const reader = SecurityLakeReaderService.create({
    queue,
    objects: observed,
    events: events ?? store,
    now,
    ...(decodeLimits === undefined ? {} : { decodeLimits }),
    ...(runBudget === undefined ? {} : { runBudget }),
  });
  const parsed = securityLakePullConfigSchema.parse({
    adapter: "aws_security_lake",
    region: "eu-west-1",
    subscriberRoleArn: "arn:aws:iam::123456789012:role/AmazonSecurityLake-subscriber",
    queueUrl: "https://sqs.eu-west-1.amazonaws.com/123456789012/acme-subscriber",
    ...config,
  });
  // Each read is a scheduled run, a minute after the one before.
  const read = () => {
    clock.ms += 60_000;
    return reader.readOnce({ tenantId: TENANT, sourceId: SOURCE, config: parsed, credentials: {} });
  };
  const stored = () =>
    store.findAll({ tenantId: TENANT, sinceMs: 0, sinceEventId: "", limit: 100 });
  return { queue, objects, store, read, stored, clock, fetched };
}

describe("SecurityLakeReaderService", () => {
  describe("given a CloudTrail file with two Bedrock calls and one S3 call", () => {
    /** @scenario Bedrock calls in a CloudTrail Parquet file are stored and the other events dropped */
    it("stores the Bedrock calls under security_lake with principal and model, and drops the S3 call", async () => {
      const { queue, objects, read, stored } = setup();
      objects.seedBytes({ bucket: BUCKET, key: MGMT_KEY, bytes: cloudTrailParquet(MIXED_CALLS) });
      queue.send({ body: notification(MGMT_KEY) });

      const result = await read();

      expect(result).toMatchObject({
        messages: 1,
        objects: 1,
        rows: 3,
        written: 2,
        dropped: 1,
        stoppedEarly: false,
      });
      const rows = await stored();
      expect(rows.map((row) => row.eventId).toSorted()).toEqual([
        `security_lake:${SOURCE}:ct-1`,
        `security_lake:${SOURCE}:ct-2`,
      ]);
      expect(rows.every((row) => row.sourceType === "security_lake")).toBe(true);
      expect(rows.every((row) => row.actorUserId === PRINCIPAL)).toBe(true);
      expect(rows.map((row) => row.targetName).toSorted()).toEqual([
        "amazon.nova-pro-v1:0",
        "anthropic.claude-sonnet-5-5",
      ]);
      expect(queue.pending()).toEqual([]);
    });
  });

  describe("given a file that was already read", () => {
    /** @scenario A redelivered message does not duplicate events */
    it("keeps the same identities and count when the notification comes again", async () => {
      const { queue, objects, read, stored } = setup();
      objects.seedBytes({ bucket: BUCKET, key: MGMT_KEY, bytes: cloudTrailParquet(MIXED_CALLS) });
      queue.send({ body: notification(MGMT_KEY) });
      await read();
      const before = (await stored()).map((row) => row.eventId).toSorted();

      queue.send({ body: notification(MGMT_KEY) });
      const again = await read();

      expect(again.written).toBe(2);
      expect((await stored()).map((row) => row.eventId).toSorted()).toEqual(before);
    });
  });

  describe("given a Bedrock call with no uid read twice", () => {
    it("writes one row", async () => {
      const { queue, objects, read, stored } = setup();
      const calls = [{ ...MIXED_CALLS[0]!, uid: null }];
      objects.seedBytes({ bucket: BUCKET, key: MGMT_KEY, bytes: cloudTrailParquet(calls) });
      queue.send({ body: notification(MGMT_KEY) });
      queue.send({ body: notification(MGMT_KEY) });

      await read();

      const rows = await stored();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.eventId).toMatch(new RegExp(`^security_lake:${SOURCE}:sha256:`));
    });
  });

  describe("given the governance store refuses the write", () => {
    /** @scenario A message is deleted only after its events are written */
    it("fails the read and leaves the message on the queue", async () => {
      const refusing: GovernanceOcsfEventSink = {
        insertEvents: async (_rows: GovernanceOcsfEvent[]) => {
          throw new Error("clickhouse unavailable");
        },
      };
      const { queue, objects, read } = setup({ events: refusing });
      objects.seedBytes({ bucket: BUCKET, key: MGMT_KEY, bytes: cloudTrailParquet(MIXED_CALLS) });
      const messageId = queue.send({ body: notification(MGMT_KEY) });

      await expect(read()).rejects.toThrow("clickhouse unavailable");
      expect(queue.pending()).toEqual([messageId]);
    });
  });

  describe("given the source reads only CLOUD_TRAIL_MGMT and a file under S3_DATA", () => {
    /** @scenario A file outside the selected sources is skipped and its message deleted */
    it("stores nothing and deletes the message", async () => {
      const { queue, objects, read, stored } = setup({ config: { sources: ["CLOUD_TRAIL_MGMT"] } });
      objects.seedBytes({ bucket: BUCKET, key: DATA_KEY, bytes: cloudTrailParquet(MIXED_CALLS) });
      queue.send({ body: notification(DATA_KEY) });

      const result = await read();

      expect(result).toMatchObject({ objects: 0, written: 0, deleted: 1 });
      expect(await stored()).toEqual([]);
      expect(queue.pending()).toEqual([]);
    });
  });

  describe("given an object that is not a Parquet file", () => {
    /** @scenario An unreadable Parquet object stays on the queue until its receive limit */
    it("leaves the message for another try before the limit", async () => {
      const { queue, objects, read } = setup({ config: { maxReceives: 3 } });
      objects.seedBytes({ bucket: BUCKET, key: MGMT_KEY, bytes: new TextEncoder().encode("nope") });
      const messageId = queue.send({ body: notification(MGMT_KEY) });

      const result = await read();

      expect(result).toMatchObject({ retried: 1, deleted: 0, poison: [], stoppedEarly: true });
      expect(queue.pending()).toEqual([messageId]);
    });

    it("gives it every try when the run goes on past the retry delay", async () => {
      const holder: { clock?: { ms: number } } = {};
      const reads: string[] = [];
      const { queue, objects, read, clock } = setup({
        config: { maxReceives: 3 },
        onRead: (key) => {
          reads.push(key);
          holder.clock!.ms += 20_000;
        },
      });
      holder.clock = clock;
      objects.seedBytes({ bucket: BUCKET, key: MGMT_KEY, bytes: new TextEncoder().encode("nope") });
      queue.send({ body: notification(MGMT_KEY) });
      for (const n of [1, 2, 3]) {
        const key = MGMT_KEY.replace("a.parquet", `ok-${n}.parquet`);
        objects.seedBytes({ bucket: BUCKET, key, bytes: cloudTrailParquet(MIXED_CALLS) });
        queue.send({ body: notification(key) });
      }

      const results = [await read(), await read(), await read()];

      expect(reads.filter((key) => key === MGMT_KEY)).toHaveLength(3);
      expect(results.map((result) => result.poison.length)).toEqual([0, 0, 1]);
      expect(queue.pending()).toEqual([]);
    });

    /** @scenario An object past its receive limit is recorded as poison and deleted */
    it("records it as poison and deletes it at the limit", async () => {
      const { queue, objects, read } = setup({ config: { maxReceives: 2 } });
      objects.seedBytes({ bucket: BUCKET, key: MGMT_KEY, bytes: new TextEncoder().encode("nope") });
      queue.send({ body: notification(MGMT_KEY) });

      await read();
      const result = await read();

      expect(result.poison).toHaveLength(1);
      expect(result.poison[0]).toMatchObject({ key: MGMT_KEY });
      expect(result.poison[0]!.reason.length).toBeGreaterThan(0);
      expect(queue.pending()).toEqual([]);
    });

    /** @scenario A corrupt object's poison reason says it is not a readable Parquet file */
    it("records the reason as an unreadable Parquet file rather than an AWS failure", async () => {
      const { queue, objects, read } = setup({ config: { maxReceives: 1 } });
      objects.seedBytes({ bucket: BUCKET, key: MGMT_KEY, bytes: new TextEncoder().encode("nope") });
      queue.send({ body: notification(MGMT_KEY) });

      const result = await read();

      expect(result.poison).toHaveLength(1);
      expect(result.poison[0]!.reason).toMatch(/^The object is not a readable Parquet file/);
      expect(result.poison[0]!.reason).not.toMatch(/AWS/);
    });
  });

  describe("given a notification whose second object stays unreadable", () => {
    /** @scenario Events of the readable objects are kept when a later object becomes poison */
    it("writes the earlier object's events before recording the poison", async () => {
      const { queue, objects, read, stored } = setup({ config: { maxReceives: 1 } });
      const badKey = MGMT_KEY.replace("a.parquet", "c.parquet");
      objects.seedBytes({ bucket: BUCKET, key: MGMT_KEY, bytes: cloudTrailParquet(MIXED_CALLS) });
      objects.seedBytes({ bucket: BUCKET, key: badKey, bytes: new TextEncoder().encode("nope") });
      const record = (key: string) => ({
        eventName: "ObjectCreated:Put",
        s3: { bucket: { name: BUCKET }, object: { key } },
      });
      queue.send({ body: JSON.stringify({ Records: [record(MGMT_KEY), record(badKey)] }) });

      const result = await read();

      expect(result.poison).toMatchObject([{ key: badKey }]);
      expect(await stored()).toHaveLength(2);
      expect(queue.pending()).toEqual([]);
    });
  });

  describe("given a notification whose middle object stays unreadable", () => {
    it("writes the objects on both sides of it before recording the poison", async () => {
      const { queue, objects, read, stored } = setup({ config: { maxReceives: 1 } });
      const badKey = MGMT_KEY.replace("a.parquet", "b.parquet");
      const lastKey = MGMT_KEY.replace("a.parquet", "c.parquet");
      objects.seedBytes({ bucket: BUCKET, key: MGMT_KEY, bytes: cloudTrailParquet(MIXED_CALLS) });
      objects.seedBytes({ bucket: BUCKET, key: badKey, bytes: new TextEncoder().encode("nope") });
      const laterCalls = MIXED_CALLS.map((call) => ({ ...call, uid: `${call.uid}-later` }));
      objects.seedBytes({ bucket: BUCKET, key: lastKey, bytes: cloudTrailParquet(laterCalls) });
      const record = (key: string) => ({
        eventName: "ObjectCreated:Put",
        s3: { bucket: { name: BUCKET }, object: { key } },
      });
      queue.send({ body: JSON.stringify({ Records: [MGMT_KEY, badKey, lastKey].map(record) }) });

      const result = await read();

      expect(result.poison).toMatchObject([{ key: badKey }]);
      expect(await stored()).toHaveLength(4);
      expect(queue.pending()).toEqual([]);
    });
  });

  describe("given rows past the OCSF ingest limits", () => {
    /** @scenario A Security Lake row past the OCSF event limits is counted invalid and not stored */
    it("refuses a row over 64 KiB in bytes and a class_uid out of range, and keeps the rest", async () => {
      const multibyte = "é".repeat(45_600);
      expect(new TextEncoder().encode(multibyte).byteLength).toBeGreaterThan(91_000);
      expect(multibyte.length).toBeLessThan(64 * 1024);
      const rows = [
        { uid: "ok", classUid: 6003n, prompt: "hello" },
        { uid: "big", classUid: 6003n, prompt: multibyte },
        { uid: "bad-class", classUid: 99_999_999_999n, prompt: "hello" },
      ];
      const buffer = parquetWriteBuffer({
        columnData: [
          { name: "class_uid", data: rows.map((row) => row.classUid), type: "INT64" },
          { name: "activity_id", data: rows.map(() => 99), type: "INT32" },
          { name: "severity_id", data: rows.map(() => 1), type: "INT32" },
          { name: "time", data: rows.map(() => BigInt(NOW_MS)), type: "INT64" },
          { name: "metadata", data: rows.map((row) => ({ uid: row.uid, version: "1.1.0" })) },
          {
            name: "api",
            data: rows.map((row) => ({
              operation: "InvokeModel",
              service: { name: "bedrock.amazonaws.com" },
              request: {
                data: JSON.stringify({ modelId: "anthropic.claude-v5", prompt: row.prompt }),
              },
            })),
          },
          { name: "actor", data: rows.map(() => ({ user: { uid: PRINCIPAL } })) },
          { name: "cloud", data: rows.map(() => ({ region: "eu-west-1", provider: "AWS" })) },
        ],
      });
      const { queue, objects, read, stored } = setup();
      objects.seedBytes({ bucket: BUCKET, key: MGMT_KEY, bytes: new Uint8Array(buffer) });
      queue.send({ body: notification(MGMT_KEY) });

      const result = await read();

      expect(result).toMatchObject({ rows: 3, written: 1, invalid: 2, deleted: 1 });
      expect((await stored()).map((row) => row.eventId)).toEqual([`security_lake:${SOURCE}:ok`]);
    });
  });

  describe("given rows dated further ahead of the reader's clock than OCSF allows", () => {
    it("counts them invalid and stores none", async () => {
      const { queue, objects, read, stored, clock } = setup();
      objects.seedBytes({ bucket: BUCKET, key: MGMT_KEY, bytes: cloudTrailParquet(MIXED_CALLS) });
      queue.send({ body: notification(MGMT_KEY) });
      clock.ms = NOW_MS - OCSF_INGEST_MAX_FUTURE_MS - 10 * 60_000;

      const result = await read();

      expect(result).toMatchObject({ rows: 3, written: 0, invalid: 3 });
      expect(await stored()).toEqual([]);
    });
  });

  describe("given a small file that inflates past the decompressed byte cap", () => {
    /** @scenario An object that decodes past the size or row caps is recorded as poison at once */
    it("records it as poison on the first read and stores nothing", async () => {
      const filler = "x".repeat(64 * 1024);
      const buffer = parquetWriteBuffer({
        columnData: [{ name: "filler", data: [filler, filler, filler, filler], type: "STRING" }],
      });
      const bytes = new Uint8Array(buffer);
      expect(bytes.byteLength).toBeLessThan(16 * 1024);
      const { queue, objects, read, stored } = setup({
        decodeLimits: { maxDecompressedBytes: 32 * 1024, maxRows: 1000 },
      });
      objects.seedBytes({ bucket: BUCKET, key: MGMT_KEY, bytes });
      queue.send({ body: notification(MGMT_KEY) });

      const result = await read();

      expect(result).toMatchObject({ retried: 0, deleted: 1, written: 0 });
      expect(result.poison).toMatchObject([{ key: MGMT_KEY }]);
      expect(result.poison[0]!.reason).toContain("decompressed size");
      expect(await stored()).toHaveLength(0);
    });
  });

  describe("given an uncompressed file whose dictionary repeats one large value", () => {
    it("counts the decoded bytes and records it as poison", async () => {
      const filler = "x".repeat(16 * 1024);
      const buffer = parquetWriteBuffer({
        codec: "UNCOMPRESSED",
        columnData: [
          { name: "filler", data: Array.from({ length: 400 }, () => filler), type: "STRING" },
        ],
      });
      const bytes = new Uint8Array(buffer);
      expect(bytes.byteLength).toBeLessThan(64 * 1024);
      const { queue, objects, read, stored } = setup({
        decodeLimits: { maxDecompressedBytes: 1024 * 1024, maxRows: 1000 },
      });
      objects.seedBytes({ bucket: BUCKET, key: MGMT_KEY, bytes });
      queue.send({ body: notification(MGMT_KEY) });

      const result = await read();

      expect(result).toMatchObject({ retried: 0, deleted: 1, written: 0 });
      expect(result.poison[0]!.reason).toContain("decoded size");
      expect(await stored()).toHaveLength(0);
    });
  });

  describe("given a file with more rows than the row cap", () => {
    it("records it as poison without decoding it", async () => {
      const { queue, objects, read } = setup({
        decodeLimits: { maxDecompressedBytes: 1024 * 1024, maxRows: 2 },
      });
      objects.seedBytes({ bucket: BUCKET, key: MGMT_KEY, bytes: cloudTrailParquet(MIXED_CALLS) });
      queue.send({ body: notification(MGMT_KEY) });

      const result = await read();

      expect(result).toMatchObject({ retried: 0, deleted: 1, rows: 0, written: 0 });
      expect(result.poison[0]!.reason).toContain("row limit");
    });
  });

  describe("given a message whose body is not JSON", () => {
    /** @scenario A message that is not a notification is recorded as poison and deleted */
    it("records it as poison and deletes it", async () => {
      const { queue, read } = setup();
      queue.send({ body: "not json" });

      const result = await read();

      expect(result.poison).toEqual([
        { messageId: "message-1", key: "", reason: "message body is not a JSON object" },
      ]);
      expect(queue.pending()).toEqual([]);
    });
  });

  describe("given an EventBridge Object Deleted notification", () => {
    /** @scenario An EventBridge Object Deleted notification is acknowledged without a read */
    it("deletes the message without fetching the object or recording poison", async () => {
      const { queue, read, fetched } = setup();
      queue.send({
        body: JSON.stringify({
          "detail-type": "Object Deleted",
          source: "aws.s3",
          detail: { bucket: { name: BUCKET }, object: { key: MGMT_KEY } },
        }),
      });

      const result = await read();

      expect(fetched).toEqual([]);
      expect(result).toMatchObject({ deleted: 1, retried: 0, poison: [] });
      expect(queue.pending()).toEqual([]);
    });
  });

  describe("given a batch whose reads together take longer than the visibility timeout", () => {
    /** @scenario A slow read keeps its messages hidden from other readers */
    it("holds each message so another reader never receives it, and deletes them all", async () => {
      const keys = [1, 2, 3].map(
        (n) => `aws/CLOUD_TRAIL_MGMT/2.0/region=eu-west-1/accountId=123456789012/${n}.parquet`,
      );
      const competitor: string[] = [];
      const holder: { queue?: MemorySecurityLakeQueueChannel; clock?: { ms: number } } = {};
      const { queue, objects, read, stored, clock } = setup({
        onRead: async () => {
          holder.clock!.ms += 20_000;
          const taken = await holder.queue!.receive({ maxMessages: 10 });
          competitor.push(...taken.map((message) => message.messageId));
        },
      });
      holder.queue = queue;
      holder.clock = clock;
      keys.forEach((key, n) => {
        objects.seedBytes({
          bucket: BUCKET,
          key,
          bytes: cloudTrailParquet([{ ...MIXED_CALLS[0]!, uid: `ct-slow-${n}` }]),
        });
        queue.send({ body: notification(key) });
      });

      const result = await read();

      expect(competitor).toEqual([]);
      expect(result).toMatchObject({ messages: 3, deleted: 3, written: 3, poison: [] });
      expect(queue.pending()).toEqual([]);
      expect(await stored()).toHaveLength(3);
    });
  });

  describe("given a batch that passes the run's byte budget after its first object", () => {
    /** @scenario A read stops taking messages past its time or byte budget */
    it("hands the rest back at once and reads them on the next run", async () => {
      const keys = [1, 2, 3].map(
        (n) => `aws/CLOUD_TRAIL_MGMT/2.0/region=eu-west-1/accountId=123456789012/${n}.parquet`,
      );
      const { queue, objects, read, stored } = setup({
        runBudget: { maxMs: 60_000, maxBytes: 1 },
      });
      keys.forEach((key, n) => {
        objects.seedBytes({
          bucket: BUCKET,
          key,
          bytes: cloudTrailParquet([{ ...MIXED_CALLS[0]!, uid: `ct-budget-${n}` }]),
        });
        queue.send({ body: notification(key) });
      });

      const first = await read();
      expect(first).toMatchObject({ messages: 1, deleted: 1 });
      expect(queue.pending()).toHaveLength(2);

      await read();
      await read();

      expect(queue.pending()).toEqual([]);
      expect(await stored()).toHaveLength(3);
    });

    it("stops inside a notification that names more objects than the budget allows", async () => {
      const secondKey = MGMT_KEY.replace("a.parquet", "c.parquet");
      const { queue, objects, read, stored, fetched } = setup({
        config: { maxReceives: 2 },
        runBudget: { maxMs: 60_000, maxBytes: 1 },
      });
      objects.seedBytes({ bucket: BUCKET, key: MGMT_KEY, bytes: cloudTrailParquet(MIXED_CALLS) });
      const laterCalls = MIXED_CALLS.map((call) => ({ ...call, uid: `${call.uid}-later` }));
      objects.seedBytes({ bucket: BUCKET, key: secondKey, bytes: cloudTrailParquet(laterCalls) });
      const record = (key: string) => ({
        eventName: "ObjectCreated:Put",
        s3: { bucket: { name: BUCKET }, object: { key } },
      });
      queue.send({ body: JSON.stringify({ Records: [MGMT_KEY, secondKey].map(record) }) });

      const first = await read();
      expect(first).toMatchObject({ retried: 1, deleted: 0 });
      expect(fetched).toEqual([MGMT_KEY]);

      const last = await read();
      expect(last.poison).toMatchObject([{ key: secondKey }]);
      expect(await stored()).toHaveLength(2);
      expect(queue.pending()).toEqual([]);
    });

    it("hands back a notification cut short by messages read before it, without spending its tries", async () => {
      const big = MIXED_CALLS.flatMap((call) =>
        Array.from({ length: 60 }, (_, n) => ({ ...call, uid: `${call.uid}-big-${n}` })),
      );
      const bigBytes = cloudTrailParquet(big);
      const [first, second] = ["d", "e"].map((name) =>
        MGMT_KEY.replace("a.parquet", `${name}.parquet`),
      ) as [string, string];
      const { queue, objects, read, stored } = setup({
        config: { maxReceives: 1 },
        runBudget: { maxMs: 60_000, maxBytes: bigBytes.byteLength + 1 },
      });
      objects.seedBytes({ bucket: BUCKET, key: MGMT_KEY, bytes: bigBytes });
      for (const [n, key] of [first, second].entries()) {
        const calls = [{ ...MIXED_CALLS[0]!, uid: `ct-small-${n}` }];
        objects.seedBytes({ bucket: BUCKET, key, bytes: cloudTrailParquet(calls) });
      }
      const record = (key: string) => ({
        eventName: "ObjectCreated:Put",
        s3: { bucket: { name: BUCKET }, object: { key } },
      });
      queue.send({ body: notification(MGMT_KEY) });
      queue.send({ body: JSON.stringify({ Records: [first, second].map(record) }) });

      const cut = await read();
      expect(cut).toMatchObject({ deleted: 1, retried: 1, poison: [], stoppedEarly: true });
      expect(queue.pending()).toHaveLength(1);

      const rest = await read();
      expect(rest).toMatchObject({ deleted: 1, poison: [], stoppedEarly: false });
      expect((await stored()).map((row) => row.eventId)).toEqual(
        expect.arrayContaining([
          `security_lake:${SOURCE}:ct-small-0`,
          `security_lake:${SOURCE}:ct-small-1`,
        ]),
      );
    });

    it("stops starting messages once the run's time budget is spent", async () => {
      const holder: { clock?: { ms: number } } = {};
      const { queue, objects, read, clock } = setup({
        runBudget: { maxMs: 10_000, maxBytes: 1024 * 1024 * 1024 },
        onRead: () => {
          holder.clock!.ms += 15_000;
        },
      });
      holder.clock = clock;
      for (const n of [1, 2]) {
        const key = `aws/CLOUD_TRAIL_MGMT/2.0/region=eu-west-1/accountId=123456789012/${n}.parquet`;
        objects.seedBytes({ bucket: BUCKET, key, bytes: cloudTrailParquet(MIXED_CALLS) });
        queue.send({ body: notification(key) });
      }

      const result = await read();

      expect(result).toMatchObject({ messages: 1, deleted: 1, stoppedEarly: true });
      const [left] = await queue.receive({ maxMessages: 10 });
      expect(left?.receiveCount).toBe(2);
    });
  });

  describe("given a file written in several row groups", () => {
    it("reads every row group", async () => {
      const calls = Array.from({ length: 5 }, (_, n) => ({ ...MIXED_CALLS[0]!, uid: `ct-g-${n}` }));
      const bytes = cloudTrailParquet(calls, { rowGroupSize: 2 });
      const { queue, objects, read } = setup();
      // A view into a larger buffer, as a pooled allocation would hand back.
      const padded = new Uint8Array(bytes.byteLength + 16);
      padded.set(bytes, 8);
      objects.seedBytes({
        bucket: BUCKET,
        key: MGMT_KEY,
        bytes: padded.subarray(8, 8 + bytes.byteLength),
      });
      queue.send({ body: notification(MGMT_KEY) });

      const result = await read();

      expect(result).toMatchObject({ rows: 5, written: 5, deleted: 1, poison: [] });
    });

    it("refuses the object once the decoded values pass the cap in a later group", async () => {
      const filler = "y".repeat(8 * 1024);
      const buffer = parquetWriteBuffer({
        codec: "UNCOMPRESSED",
        rowGroupSize: 50,
        columnData: [
          { name: "filler", data: Array.from({ length: 200 }, () => filler), type: "STRING" },
        ],
      });
      const { queue, objects, read } = setup({
        decodeLimits: { maxDecompressedBytes: 1024 * 1024, maxRows: 1000 },
      });
      objects.seedBytes({ bucket: BUCKET, key: MGMT_KEY, bytes: new Uint8Array(buffer) });
      queue.send({ body: notification(MGMT_KEY) });

      const result = await read();

      expect(result.poison[0]?.reason).toContain("decoded size");
      expect(result).toMatchObject({ deleted: 1, written: 0 });
    });
  });
});
