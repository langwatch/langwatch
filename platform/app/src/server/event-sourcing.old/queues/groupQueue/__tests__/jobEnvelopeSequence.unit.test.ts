import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTenantId } from "~/server/event-sourcing.old/domain/tenantId";
import { decodeJobEnvelope, encodeJobEnvelope, readJobSequence } from "../jobEnvelope";
import { TieredBlobStore } from "../tieredBlobStore";
import { InMemoryJobBlobStore, InMemoryObjectStore } from "./blobTestDoubles";

const PROJECT = createTenantId("project-1");

function blobStore(): TieredBlobStore {
  return new TieredBlobStore({
    redisBlobs: new InMemoryJobBlobStore(),
    objectStoreFor: () => new InMemoryObjectStore(),
    resolveDestination: async () => ({ kind: "s3", bucket: "test-bucket" }),
  });
}

async function encodeGq2(
  data: Record<string, unknown>,
  tieredBlobs: TieredBlobStore = blobStore(),
): Promise<string> {
  return await encodeJobEnvelope({
    jobData: data,
    tieredBlobs,
    projectId: PROJECT,
    writesEnabled: true,
    queueName: "q",
  });
}

/**
 * The Lua staging script never produces these values (it splices `"sq":<n>`
 * into an already-built envelope via string surgery — see
 * GQ_SEQUENCE_HELPER_LUA in scripts.ts, which no JS test double can exercise
 * without a real Redis). These fixtures simulate exactly the framing that
 * splice produces, so readJobSequence and decodeJobEnvelope's merge can be
 * verified without one.
 */
function spliceSq(envelope: string, seq: number): string {
  const prefix = envelope.slice(0, 4);
  const barIdx = envelope.indexOf("|", 4);
  const headerLen = Number(envelope.slice(4, barIdx));
  const headerJson = envelope.slice(barIdx + 1, barIdx + 1 + headerLen);
  const body = envelope.slice(barIdx + 1 + headerLen);
  const newHeaderJson = `${headerJson.slice(0, -1)},"sq":${seq}}`;
  return `${prefix}${Buffer.byteLength(newHeaderJson)}|${newHeaderJson}${body}`;
}

describe("job envelope delivery sequence (ADR-098 §5)", () => {
  beforeEach(() => {
    vi.stubEnv("GROUP_QUEUE_ENVELOPE_WRITES_ENABLED", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("given a legacy bare-JSON job", () => {
    describe("when its sequence is read from the message", () => {
      it("reads the sequence straight off the payload", () => {
        expect(readJobSequence(JSON.stringify({ __sequence: 5 }))).toBe(5);
      });

      it("reports null when absent", () => {
        expect(readJobSequence(JSON.stringify({ hello: "world" }))).toBeNull();
      });
    });

    describe("when it is decoded", () => {
      it("includes the sequence in the decoded body", async () => {
        expect(
          await decodeJobEnvelope({
            value: JSON.stringify({ hello: "world", __sequence: 3 }),
          }),
        ).toEqual({ hello: "world", __sequence: 3 });
      });
    });
  });

  describe("given a GQ2 envelope with the sequence spliced into its header", () => {
    describe("when its body is inline", () => {
      /** @scenario A job cannot be staged without a sequence — readable off the header alone */
      it("reads the sequence without touching the body", async () => {
        const encoded = spliceSq(
          await encodeGq2({ __pipelineName: "p", hello: "world" }),
          7,
        );

        expect(readJobSequence(encoded)).toBe(7);
      });

      /** @scenario A retried job presents the same sequence it was first staged with — decode round trip */
      it("folds the sequence into the decoded body as __sequence", async () => {
        const encoded = spliceSq(
          await encodeGq2({ __pipelineName: "p", hello: "world" }),
          7,
        );

        const decoded = await decodeJobEnvelope({ value: encoded });
        expect(decoded.__sequence).toBe(7);
        expect(decoded.hello).toBe("world");
      });
    });

    describe("when its body is offloaded to a content-addressed blob", () => {
      /** @scenario A GQ1/GQ2 envelope's sequence survives a compressed, offloaded body */
      it("still reads the sequence from the header alone, with no blob I/O", async () => {
        const encoded = spliceSq(
          await encodeGq2({
            __pipelineName: "p",
            bulk: "x".repeat(200_000),
          }),
          42,
        );

        expect(readJobSequence(encoded)).toBe(42);
      });

      it("folds the sequence into the decoded body once the blob IS fetched", async () => {
        const blobs = blobStore();
        const encoded = spliceSq(
          await encodeGq2({ __pipelineName: "p", bulk: "x".repeat(200_000) }, blobs),
          42,
        );

        const decoded = await decodeJobEnvelope({
          value: encoded,
          tieredBlobs: blobs,
        });
        expect(decoded.__sequence).toBe(42);
      });
    });

    describe("when a retry rebuild already carried the sequence as ordinary machinery", () => {
      /** @scenario A retried job presents the same sequence it was first staged with */
      it("prefers the machinery-carried sequence over a stale header.sq", async () => {
        // Mirrors GroupQueueProcessor's retry rebuild: __sequence goes through
        // the normal encode path (splitMachineryFromBody lifts it into
        // header.m, same as __attempt), not through the Lua splice.
        const retried = await encodeGq2({
          __pipelineName: "p",
          __sequence: 7,
          hello: "world",
        });

        expect(readJobSequence(retried)).toBe(7);
        expect((await decodeJobEnvelope({ value: retried })).__sequence).toBe(
          7,
        );
      });
    });
  });

  describe("given a value it cannot parse at all", () => {
    it("survives without throwing", () => {
      expect(readJobSequence("GQ2|not-an-envelope")).toBeNull();
      expect(readJobSequence("{ broken json")).toBeNull();
    });
  });
});
