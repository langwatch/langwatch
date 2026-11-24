import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  DecodeFailureError,
  decodeJobEnvelope,
  readEnvelopeDescriptor,
  readEnvelopeLease,
  readJobAttempt,
  readJobPayloadBytes,
  readJobRoutingMeta,
  withJobAttempt,
} from "../jobEnvelope.ts";
import { InMemoryJobBlobStore } from "./blob-test-doubles.ts";

// Staged shapes written by v3.20.1's encodeJobEnvelope, built by hand (#9840):
// bare JSON with the flag off, `GQ1|<len>|<header v:1>` with it on.
const jobData = {
  id: "event_1",
  tenantId: "proj1",
  value: "hello",
  __pipelineName: "trace_processing",
  __jobType: "projection",
  __jobName: "traceSummary",
  __context: { traceId: "t1", queueDispatchScopeKey: "scope-a" },
  __attempt: 2,
};
const routing = {
  pipelineName: "trace_processing",
  jobType: "projection",
  jobName: "traceSummary",
};

function gq1({ header, body }: { header: Record<string, unknown>; body: string }): string {
  const headerJson = JSON.stringify(header);
  return `GQ1|${Buffer.byteLength(headerJson)}|${headerJson}${body}`;
}

function gq1Header({ e, json }: { e: string; json: string }): Record<string, unknown> {
  return {
    v: 1,
    e,
    p: jobData.__pipelineName,
    t: jobData.__jobType,
    n: jobData.__jobName,
    s: Buffer.byteLength(json),
  };
}

const bareJson = JSON.stringify(jobData);
const gq1Inline = gq1({ header: gq1Header({ e: "j", json: bareJson }), body: bareJson });
const bigJobData = { ...jobData, value: "x".repeat(2048) };
const bigJson = JSON.stringify(bigJobData);
const gq1Gzip = gq1({
  header: gq1Header({ e: "gz", json: bigJson }),
  body: gzipSync(bigJson).toString("base64"),
});

describe("jobEnvelope, values staged by 3.20.1", () => {
  describe("given a bare JSON job", () => {
    /** @scenario "A job staged by 3.20.1 as bare JSON decodes on the current worker" */
    it("decodes to the job data with its machinery in place", async () => {
      await expect(decodeJobEnvelope({ value: bareJson })).resolves.toEqual(jobData);
    });

    it("reads its routing labels and attempt from the value", () => {
      expect(readJobRoutingMeta(bareJson)).toEqual(routing);
      expect(readJobAttempt(bareJson)).toBe(2);
    });

    it("costs its stored length and is left unchanged by an attempt rewrite", () => {
      expect(readJobPayloadBytes(bareJson)).toBe(Buffer.byteLength(bareJson));
      expect(withJobAttempt({ value: bareJson, attempt: 5 })).toBe(bareJson);
    });
  });

  describe("given a GQ1 job with an inline raw body", () => {
    /** @scenario "A job staged by 3.20.1 as a GQ1 envelope decodes on the current worker" */
    it("decodes to the job data", async () => {
      await expect(decodeJobEnvelope({ value: gq1Inline })).resolves.toEqual(jobData);
    });

    it("reads routing, size and version off the header", () => {
      expect(readJobRoutingMeta(gq1Inline)).toEqual(routing);
      expect(readJobPayloadBytes(gq1Inline)).toBe(Buffer.byteLength(bareJson));
      expect(readEnvelopeDescriptor(gq1Inline)).toEqual({ format: "j", version: 1, blobId: null });
      expect(readEnvelopeLease(gq1Inline)).toBeNull();
    });
  });

  describe("given a GQ1 job with an inline gzip body", () => {
    /** @scenario "A job staged by 3.20.1 as a GQ1 envelope decodes on the current worker" */
    it("decodes to the job data", async () => {
      await expect(decodeJobEnvelope({ value: gq1Gzip })).resolves.toEqual(bigJobData);
    });

    it("costs the recorded payload size, not the compressed length", () => {
      expect(readJobPayloadBytes(gq1Gzip)).toBe(Buffer.byteLength(bigJson));
    });
  });

  describe("given a GQ1 job whose body was offloaded to the queue's blob keys", () => {
    const blobId = "5f0c2d7e-3b1a-4c8e-9d2f-0a1b2c3d4e5f";
    const value = gq1({
      header: { ...gq1Header({ e: "ref", json: bigJson }), r: blobId },
      body: "",
    });

    /** @scenario "A job staged by 3.20.1 as a GQ1 envelope decodes on the current worker" */
    it("reads the body from the blob store", async () => {
      const blobs = new InMemoryJobBlobStore();
      await blobs.put({ id: blobId, data: gzipSync(bigJson) });
      await expect(decodeJobEnvelope({ value, blobs })).resolves.toEqual(bigJobData);
    });

    it("is a missing blob when the body has expired", async () => {
      await expect(
        decodeJobEnvelope({ value, blobs: new InMemoryJobBlobStore() }),
      ).rejects.toMatchObject({ reason: "missing_blob" });
    });
  });

  describe("given a value that is neither an envelope nor a JSON object", () => {
    const junk = [
      "not json at all",
      "",
      "[1,2,3]",
      "{broken",
      '"a string"',
      `GQ1|${JSON.stringify({ v: 2, e: "j" }).length}|${JSON.stringify({ v: 2, e: "j" })}{}`,
    ];

    /** @scenario "A stored value in no supported format is still dropped as malformed" */
    it.each(junk)("rejects %j as a malformed envelope", async (value) => {
      const err = await decodeJobEnvelope({ value }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DecodeFailureError);
      expect((err as DecodeFailureError).reason).toBe("malformed_envelope");
    });
  });
});
