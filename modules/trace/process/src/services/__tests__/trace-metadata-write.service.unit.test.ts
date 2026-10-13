import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { RecordSpanCommandData } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import type { TraceSpanIngest } from "../trace-metadata-write.service.ts";
import { TraceMetadataWriteService } from "../trace-metadata-write.service.ts";

async function recordedFor(metadata: Record<string, string | string[]>) {
  const recordSpan = vi.fn<TraceSpanIngest["recordSpan"]>(async () => undefined);
  const service = TraceMetadataWriteService.create({
    ingest: createApiFixture<TraceSpanIngest>({ recordSpan }),
  });

  await service.updateTraceMetadata({ projectId: "project-1", traceId: "trace-abc", metadata });

  const [call] = recordSpan.mock.calls;
  if (call === undefined) throw new Error("no span was recorded");
  const data: RecordSpanCommandData = call[0];
  const resource = Object.fromEntries(
    (data.resource?.attributes ?? []).map((attribute) => [attribute.key, attribute.value]),
  );
  return { data, resource };
}

describe("TraceMetadataWriteService", () => {
  describe("when metadata is updated after the trace was created", () => {
    /** @scenario "PATCH endpoint injects a synthetic span with metadata as resource attributes" */
    it("records one span for the trace, carrying the metadata on its resource", async () => {
      const { data, resource } = await recordedFor({ user_id: "new-user", labels: ["qa"] });

      expect(data.tenantId).toBe("project-1");
      expect(data.span.traceId).toBe("trace-abc");
      expect(resource["langwatch.user.id"]).toEqual({ stringValue: "new-user" });
      expect(resource["langwatch.labels"]).toEqual({ stringValue: '["qa"]' });
    });

    /** @scenario "PATCH endpoint maps reserved fields to resource attributes" */
    it("maps the reserved fields onto their langwatch identity attributes", async () => {
      const { resource } = await recordedFor({
        user_id: "u1",
        customer_id: "c1",
        thread_id: "t1",
      });

      expect(resource["langwatch.user.id"]).toEqual({ stringValue: "u1" });
      expect(resource["langwatch.customer.id"]).toEqual({ stringValue: "c1" });
      expect(resource["langwatch.thread.id"]).toEqual({ stringValue: "t1" });
    });

    /** @scenario "PATCH endpoint maps custom keys to langwatch.metadata.* resource attributes" */
    it("prefixes every other key under langwatch.metadata", async () => {
      const { resource } = await recordedFor({ environment: "staging" });

      expect(resource["langwatch.metadata.environment"]).toEqual({ stringValue: "staging" });
    });
  });
});
