/**
 * The edge size check and the transient spool decision (ADR-022): under the
 * threshold nothing is written, over it the payload is spooled, and a spool
 * that refuses falls open to the inline route.
 */
import { COMMAND_INLINE_THRESHOLD, type RecordSpanCommandData } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";
import { TraceEdgeSpoolService } from "../trace-edge-spool.service";

const PROJECT_ID = "project-001";
const TRACE_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaabb";
const SPAN_ID = "bbbbbbbbbbbbbbbb";
const SPOOL_REF = "v2";

function commandCarrying({ outputBytes }: { outputBytes: number }): RecordSpanCommandData {
  return {
    tenantId: PROJECT_ID,
    occurredAt: 1700000000000,
    span: {
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      name: "test-span",
      kind: 1,
      startTimeUnixNano: { low: 0, high: 0 },
      endTimeUnixNano: { low: 1000000, high: 0 },
      attributes: [{ key: "langwatch.output", value: { stringValue: "z".repeat(outputBytes) } }],
      events: [],
      links: [],
      status: {},
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    },
    resource: null,
    instrumentationScope: null,
  } as unknown as RecordSpanCommandData;
}

function edge({ putSpool }: { putSpool: ReturnType<typeof vi.fn> }) {
  const warn = vi.fn();
  const service = TraceEdgeSpoolService.create({
    spool: { putSpool } as never,
    logger: { warn } as never,
  });
  return { service, warn };
}

const outputOf = (command: RecordSpanCommandData): string =>
  command.span.attributes?.find((attribute) => attribute.key === "langwatch.output")?.value
    ?.stringValue ?? "";

describe("the ingestion edge's oversize protection", () => {
  describe("given a command payload within the inline threshold", () => {
    describe("when the edge prepares it", () => {
      it("sends it as it is, writing no spool object", async () => {
        const putSpool = vi.fn();
        const { service } = edge({ putSpool });

        const prepared = await service.prepare(commandCarrying({ outputBytes: 10 * 1024 }));

        expect(prepared.spoolRef).toBeUndefined();
        expect(putSpool).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a command payload over the inline threshold", () => {
    describe("when the spool write succeeds", () => {
      /** @scenario "An over-threshold command is spooled to S3 transiently and reconstituted" */
      it("spools the whole payload and queues a command carrying only the reference", async () => {
        const putSpool = vi.fn().mockResolvedValue(SPOOL_REF);
        const { service } = edge({ putSpool });
        const command = commandCarrying({ outputBytes: 300 * 1024 });

        const prepared = await service.prepare(command);

        expect(prepared.spoolRef).toBe(SPOOL_REF);
        // The queued command is under the threshold that sent it here, and the
        // spool object holds the command the worker will read back whole.
        expect(Buffer.byteLength(JSON.stringify(prepared), "utf8")).toBeLessThan(
          COMMAND_INLINE_THRESHOLD,
        );
        const [spooled] = putSpool.mock.calls[0] as [
          { projectId: string; traceId: string; spanId: string; body: Buffer },
        ];
        expect(spooled).toMatchObject({
          projectId: PROJECT_ID,
          traceId: TRACE_ID,
          spanId: SPAN_ID,
        });
        expect(outputOf(JSON.parse(spooled.body.toString("utf8")) as RecordSpanCommandData)).toBe(
          "z".repeat(300 * 1024),
        );
      });
    });

    describe("when the spool write fails", () => {
      /** @scenario "When edge S3 spool PUT fails, ingestion falls back to inline (fail-open)" */
      it("sends the full payload inline and says the protection was skipped", async () => {
        const putSpool = vi.fn().mockRejectedValue(new Error("the object store refused the write"));
        const { service, warn } = edge({ putSpool });

        const prepared = await service.prepare(commandCarrying({ outputBytes: 300 * 1024 }));

        expect(prepared.spoolRef).toBeUndefined();
        expect(outputOf(prepared)).toHaveLength(300 * 1024);
        expect(warn).toHaveBeenCalledOnce();
        expect(warn.mock.calls[0]?.[1]).toContain("oversize protection skipped");
      });
    });
  });
});
