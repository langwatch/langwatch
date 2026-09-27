// @vitest-environment node
import { RUM_MAX_BODY_BYTES } from "@langwatch/react-rum/constants";
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import { MemoryRumCollectorChannel } from "../../channels/memory/memory.rum-collector.channel.ts";
import { MemoryRumRateLimitRepository } from "../../repositories/memory/memory.rum-rate-limit.repository.ts";
import { RUM_GLOBAL_PER_MINUTE, RUM_PER_CALLER_PER_MINUTE } from "../../rules/rum-ingest.rules.ts";
import { BrowserTraceIngestService } from "../browser-trace-ingest.service.ts";

const exportWith = (spanCount: number) =>
  JSON.stringify({
    resourceSpans: [{ scopeSpans: [{ spans: Array.from({ length: spanCount }, () => ({})) }] }],
  });

function ingestion({ collector = MemoryRumCollectorChannel.create() } = {}) {
  const rateLimits = MemoryRumRateLimitRepository.create();
  const { logger, lines } = createTestLogger();
  const service = BrowserTraceIngestService.create({
    rateLimits,
    collector: { configured: true, channel: collector },
    logger,
  });
  const report = (session: string, body = exportWith(1)) =>
    service.ingest({ body, session, forwardedFor: undefined });
  return { service, collector, rateLimits, lines, report };
}

async function codeOf(attempt: Promise<void>): Promise<string | undefined> {
  try {
    await attempt;
    return undefined;
  } catch (error) {
    return error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : "unhandled";
  }
}

describe("ingesting a browser trace export", () => {
  describe("given a deployment that names no collector", () => {
    it("refuses as not configured before spending any budget", async () => {
      const rateLimits = MemoryRumRateLimitRepository.create();
      const service = BrowserTraceIngestService.create({
        rateLimits,
        collector: { configured: false },
      });

      expect(
        await codeOf(
          service.ingest({ body: exportWith(1), session: "s", forwardedFor: undefined }),
        ),
      ).toBe("rum_ingest_disabled");
      expect(rateLimits.countKeys()).toBe(0);
    });
  });

  describe("when a small report carries more spans than the cap", () => {
    /** @scenario "A small report carrying too many spans is refused" */
    it("refuses it and forwards nothing", async () => {
      const { collector, report } = ingestion();
      const many = exportWith(5_000);
      expect(many.length).toBeLessThan(RUM_MAX_BODY_BYTES);

      expect(await codeOf(report("spans", many))).toBe("rum_payload_too_large");
      expect(collector.sent()).toEqual([]);
    });
  });

  describe("when the report is not a walkable export", () => {
    /** @scenario "A report that is not a walkable OTLP export is refused as malformed" */
    it.each([
      ["not json", "<html>"],
      ["no spans at all", '{"resourceSpans":[{"resource":{}}]}'],
      ["spans that are not a list", '{"resourceSpans":[{"scopeSpans":[{"spans":7}]}]}'],
    ])("refuses %s as malformed and forwards nothing", async (_case, body) => {
      const { collector, report } = ingestion();

      expect(await codeOf(report(`invalid-${_case}`, body))).toBe("rum_payload_invalid");
      expect(collector.sent()).toEqual([]);
    });
  });

  describe("when one caller floods the door under one identity", () => {
    /** @scenario "One caller flooding the door is throttled at its own budget" */
    it("accepts exactly its budget and refuses the rest", async () => {
      const { report } = ingestion();
      const attempts = RUM_PER_CALLER_PER_MINUTE + 5;
      const codes: (string | undefined)[] = [];
      for (let i = 0; i < attempts; i++) codes.push(await codeOf(report("flood")));

      expect(codes.filter((code) => code === undefined)).toHaveLength(RUM_PER_CALLER_PER_MINUTE);
      expect(codes.filter((code) => code === "rum_rate_limited")).toHaveLength(5);
    });
  });

  describe("when a flood rotates the identity it claims", () => {
    /** @scenario "A flood rotating its claimed identity is bounded by the door's shared budget" */
    it("refuses on the shared budget whatever identity is claimed", async () => {
      const { report } = ingestion();
      for (let i = 0; i < RUM_GLOBAL_PER_MINUTE; i++) await report(`rotating-${i}`);

      expect(await codeOf(report("rotating-one-more"))).toBe("rum_rate_limited");
    });

    /** @scenario "A refused flood mints no bucket named by the caller" */
    it("refuses before opening a bucket the caller names", async () => {
      const { report, rateLimits } = ingestion();
      for (let i = 0; i < RUM_GLOBAL_PER_MINUTE; i++) await report(`rotating-${i}`);
      const bucketsBefore = rateLimits.countKeys();

      expect(await codeOf(report("an-identity-never-seen-before"))).toBe("rum_rate_limited");
      expect(rateLimits.countKeys()).toBe(bucketsBefore);
    });
  });

  describe("when the collector cannot be reached", () => {
    /** @scenario "A collector outage is not surfaced to the browser" */
    it("accepts the report and logs the dropped forward", async () => {
      const { report, lines } = ingestion({
        collector: MemoryRumCollectorChannel.create({
          answer: () => Promise.reject(new Error("connect ECONNREFUSED")),
        }),
      });

      await expect(report("unreachable")).resolves.toBeUndefined();
      await expect
        .poll(() => lines.findLine("warn", "could not forward browser telemetry"))
        .toBeDefined();
    });
  });

  describe("when the collector rejects the forward", () => {
    it("accepts the report and logs the collector's status", async () => {
      const { report, lines } = ingestion({
        collector: MemoryRumCollectorChannel.create({
          answer: () => Promise.resolve({ accepted: false, status: 401 }),
        }),
      });

      await expect(report("rejected")).resolves.toBeUndefined();
      await expect
        .poll(() => lines.findLine("warn", "collector rejected browser telemetry")?.status)
        .toBe(401);
    });
  });
});
