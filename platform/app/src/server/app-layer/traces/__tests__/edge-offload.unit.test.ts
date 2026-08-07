/**
 * Unit tests for the edge size-check + transient S3 spool decision.
 *
 * ADR-022 §"Edge handles oversize protection only":
 *   - payload ≤ 256 KB → no S3 PUT; regular command returned
 *   - payload > 256 KB + PUT succeeds → oversized command with spoolRef only; payload NOT in command
 *   - payload > 256 KB + PUT fails → fail-open: regular command with full inline; warn log emitted
 *   - warn message contains "oversize protection skipped"
 *   - fail-open payload is then bounded by capOversizedAttributes(256 KB)
 *
 * BDD structure: describe("given X") → describe("when Y") → it("…").
 * No "should" in it() names (project convention).
 */

import { describe, expect, it, vi } from "vitest";
import type { RecordSpanCommandData } from "~/server/event-sourcing/pipelines/trace-processing/schemas/commands";
import {
  capOversizedAttributes,
  DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES,
} from "~/server/event-sourcing/pipelines/trace-processing/utils/capOversizedAttributes";
import type { BlobStore } from "../blob-store.service";
import { maybeSpool, type SpoolLogger } from "../edge-spool";
import { COMMAND_INLINE_THRESHOLD } from "../lean-for-projection";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT_ID = "tenant-001";
const TRACE_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaabb";
const SPAN_ID = "bbbbbbbbbbbbbbbb";

/** Build a RecordSpanCommandData with a langwatch.output of `outputSize` bytes. */
function makeCommandData({
  outputSize,
}: {
  outputSize: number;
}): RecordSpanCommandData {
  return {
    tenantId: TENANT_ID,
    occurredAt: 1700000000000,
    span: {
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      name: "test-span",
      kind: 1,
      startTimeUnixNano: { low: 0, high: 0 },
      endTimeUnixNano: { low: 1000000, high: 0 },
      attributes: [
        {
          key: "langwatch.output",
          value: { stringValue: "z".repeat(outputSize) },
        },
      ],
      events: [],
      links: [],
      status: {},
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    },
    resource: null,
    instrumentationScope: null,
  };
}

/** Builds a fake BlobStore where putSpool returns a spool ref string. */
function makeBlobStore({
  putSpoolResult,
}: {
  putSpoolResult: "success" | "fail";
}): BlobStore {
  return {
    putSpool: vi.fn().mockImplementation(async () => {
      if (putSpoolResult === "fail") {
        throw new Error("S3 PUT failed");
      }
      return `trace-blobs/spool/${TENANT_ID}/${TRACE_ID}/${SPAN_ID}`;
    }),
    deleteSpool: vi.fn().mockResolvedValue(undefined),
    getSpool: vi.fn(),
    put: vi.fn(),
    get: vi.fn(),
  } as unknown as BlobStore;
}

function makeLogger(): SpoolLogger & { warn: ReturnType<typeof vi.fn> } {
  return { warn: vi.fn() } as unknown as SpoolLogger & {
    warn: ReturnType<typeof vi.fn>;
  };
}

// ---------------------------------------------------------------------------
// Small payload — COMMAND_INLINE_THRESHOLD NOT exceeded
// ---------------------------------------------------------------------------

/**
 * @scenario An over-threshold command is spooled to S3 transiently and reconstituted
 * @scenario When edge S3 spool PUT fails, ingestion falls back to inline (fail-open)
 */
describe("given a command payload ≤ COMMAND_INLINE_THRESHOLD (256 KB)", () => {
  describe("when maybeSpool is called", () => {
    it("returns the data unchanged with no S3 PUT issued", async () => {
      // 10 KB — well under 256 KB
      const data = makeCommandData({ outputSize: 10 * 1024 });
      const blobStore = makeBlobStore({ putSpoolResult: "success" });
      const logger = makeLogger();

      const result = await maybeSpool({ data, blobStore, logger });

      // No spool ref in the returned command
      expect(result.spoolRef).toBeUndefined();

      // putSpool was never called
      expect(
        (blobStore as unknown as { putSpool: ReturnType<typeof vi.fn> })
          .putSpool,
      ).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// Large payload — COMMAND_INLINE_THRESHOLD exceeded, PUT succeeds
// ---------------------------------------------------------------------------

describe("given a command payload > COMMAND_INLINE_THRESHOLD (256 KB) and the S3 spool PUT succeeds", () => {
  describe("when maybeSpool is called", () => {
    it("returns an oversized command with spoolRef only — the original large payload is NOT in the returned command data", async () => {
      // 300 KB output — exceeds 256 KB command threshold when serialized
      const data = makeCommandData({ outputSize: 300 * 1024 });
      const blobStore = makeBlobStore({ putSpoolResult: "success" });
      const logger = makeLogger();

      const result = await maybeSpool({ data, blobStore, logger });

      // spoolRef must be set
      expect(result.spoolRef).toBeDefined();
      expect(typeof result.spoolRef).toBe("string");

      // The large output attr must NOT be in the returned command's span
      const outputAttr = result.span.attributes?.find(
        (a) => a.key === "langwatch.output",
      );
      const outputSize = Buffer.byteLength(
        outputAttr?.value?.stringValue ?? "",
        "utf-8",
      );
      // Returned command must be well under the threshold (it carries only id fields)
      expect(outputSize).toBeLessThan(COMMAND_INLINE_THRESHOLD);
    });
  });
});

// ---------------------------------------------------------------------------
// Large payload — COMMAND_INLINE_THRESHOLD exceeded, PUT fails (fail-open)
// ---------------------------------------------------------------------------

describe("given a command payload > COMMAND_INLINE_THRESHOLD and the S3 spool PUT fails", () => {
  describe("when maybeSpool is called", () => {
    /** @scenario When edge S3 spool PUT fails, ingestion falls back to inline (fail-open) */
    it("returns the regular command with full inline payload (fail-open, no spoolRef)", async () => {
      const data = makeCommandData({ outputSize: 300 * 1024 });
      const blobStore = makeBlobStore({ putSpoolResult: "fail" });
      const logger = makeLogger();

      const result = await maybeSpool({ data, blobStore, logger });

      // No spoolRef — fell back to inline
      expect(result.spoolRef).toBeUndefined();

      // Full payload is intact in the returned command
      const outputAttr = result.span.attributes?.find(
        (a) => a.key === "langwatch.output",
      );
      expect(
        Buffer.byteLength(outputAttr?.value?.stringValue ?? "", "utf-8"),
      ).toBe(300 * 1024);
    });

    it("emits a warn log containing 'oversize protection skipped'", async () => {
      const data = makeCommandData({ outputSize: 300 * 1024 });
      const blobStore = makeBlobStore({ putSpoolResult: "fail" });
      const logger = makeLogger();

      await maybeSpool({ data, blobStore, logger });

      expect(logger.warn).toHaveBeenCalledOnce();
      const warnArg: unknown = logger.warn.mock.calls[0]?.[0];
      expect(typeof warnArg === "string" ? warnArg : "").toContain(
        "oversize protection skipped",
      );
    });
  });

  // What the deployment actually loses when the spool is unavailable: the
  // span keeps flowing, and the value it carries is bounded downstream by
  // the same cap that existed before ADR-022. This is the consequence the
  // fail-open warn tells operators about, exercised rather than described.
  describe("when the fallen-back command reaches the command worker", () => {
    /** @scenario When edge S3 spool PUT fails, ingestion falls back to inline (fail-open) */
    it("has its oversized attribute value replaced by the 256 KB cap's truncation marker", async () => {
      const data = makeCommandData({ outputSize: 300 * 1024 });
      const blobStore = makeBlobStore({ putSpoolResult: "fail" });
      const logger = makeLogger();

      const result = await maybeSpool({ data, blobStore, logger });
      const capped = capOversizedAttributes(result.span, result.resource);

      expect(capped).toBe(1);
      const outputValue = result.span.attributes?.find(
        (a) => a.key === "langwatch.output",
      )?.value?.stringValue;
      expect(outputValue).toContain("[truncated:");
      expect(Buffer.byteLength(outputValue ?? "", "utf-8")).toBeLessThanOrEqual(
        DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES,
      );
    });
  });
});
