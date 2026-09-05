/**
 * @vitest-environment node
 * Spec: specs/trace-processing/trace-media-blob-extraction.feature
 * A fake TraceMediaStorePort content-addresses bytes the same way the real StoredObjectsService does (same bytes -> same id, isDuplicate:true on the second write), so dedup scenarios exercise real behaviour, not a mock returning canned answers. maybeExtractSpanMedia is production code; only its storage and feature-flag boundaries are faked.
 */
import { TraceEdgeMediaExtractionService } from "../trace-edge-media-extraction.service";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { RecordSpanCommandData } from "@langwatch/trace-contract";
import type { TraceMediaStorePort } from "../../ports/trace-media-store.port";
import { type EdgeMediaExtractionDeps } from "../trace-edge-media-extraction.service";

function flags(enabled = true): FeatureFlagService {
  return { isEnabled: async () => enabled } as never;
}

function fakeStore(): { service: TraceMediaStorePort; calls: number } {
  const byHash = new Map<string, string>();
  const state = { calls: 0 };
  const service: TraceMediaStorePort = {
    storeFromBytes: async ({ mediaType, bytes }) => {
      const hash = createHash("sha256").update(bytes).digest("hex");
      const existing = byHash.get(hash);
      if (existing) {
        return { id: existing, mediaType, isDuplicate: true };
      }
      state.calls++;
      const id = `so-${hash.slice(0, 12)}`;
      byHash.set(hash, id);
      return { id, mediaType, isDuplicate: false };
    },
  };
  return {
    service,
    get calls() {
      return state.calls;
    },
  };
}

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn() };
}

function baseSpan(attributes: RecordSpanCommandData["span"]["attributes"] = []) {
  return {
    traceId: "trace-1",
    spanId: "span-1",
    name: "llm-call",
    kind: 1,
    startTimeUnixNano: { low: 0, high: 0 },
    endTimeUnixNano: { low: 0, high: 0 },
    attributes,
    events: [],
    links: [],
    status: { message: null, code: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as RecordSpanCommandData["span"];
}

function baseCommand(span: RecordSpanCommandData["span"]): RecordSpanCommandData {
  return {
    tenantId: "project-1",
    span,
    resource: null,
    instrumentationScope: null,
    occurredAt: Date.now(),
  };
}

function baseDeps(overrides: Partial<EdgeMediaExtractionDeps> = {}): EdgeMediaExtractionDeps {
  return {
    featureFlags: flags(),
    hasContentDropRules: async () => false,
    ...overrides,
  };
}

const PNG_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("TraceEdgeMediaExtractionService.maybeExtractSpanMedia", () => {
  describe("given a data-URI image inside an image_url part", () => {
    /** @scenario "A data-URI image inside an image_url part is externalized" */
    it("externalizes the PNG bytes and rewrites the part to a stored reference", async () => {
      const { service } = fakeStore();
      const messages = [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: PNG_DATA_URI } }],
        },
      ];
      const span = baseSpan([
        { key: "langwatch.input", value: { stringValue: JSON.stringify(messages) } },
      ]);
      const command = baseCommand(span);

      const result = await TraceEdgeMediaExtractionService.maybeExtractSpanMedia({
        data: command,
        deps: baseDeps({ service }),
        logger: silentLogger(),
      });

      const rewritten = result.span.attributes[0]!.value.stringValue!;
      expect(rewritten).not.toContain("base64");
      const parsed = JSON.parse(rewritten);
      expect(parsed[0].content[0].image_url.url).toMatch(/^\/api\/files\/project-1\//);
    });
  });

  describe("given an AI-SDK audio file part inside a span input", () => {
    /** @scenario "An AI-SDK audio file part inside a span input is externalized before staging" */
    it("externalizes the audio bytes and rewrites to an input_audio part with no inline data", async () => {
      const { service } = fakeStore();
      const messages = [
        {
          role: "user",
          content: [{ type: "file", mediaType: "audio/pcm16", data: "UGNNMTYAAAA=" }],
        },
      ];
      const span = baseSpan([
        { key: "langwatch.input", value: { stringValue: JSON.stringify(messages) } },
      ]);
      const command = baseCommand(span);

      const result = await TraceEdgeMediaExtractionService.maybeExtractSpanMedia({
        data: command,
        deps: baseDeps({ service }),
        logger: silentLogger(),
      });

      const rewritten = result.span.attributes[0]!.value.stringValue!;
      expect(rewritten).not.toContain("UGNNMTYAAAA=");
      const part = JSON.parse(rewritten)[0].content[0];
      expect(part.type).toBe("input_audio");
      expect(JSON.stringify(part)).not.toMatch(/base64|"data":"[A-Za-z0-9+/=]{8,}"/);
    });
  });

  describe("given a PDF file part with a filename", () => {
    /** @scenario "A PDF file part is externalized to a binary reference preserving the filename" */
    it("keeps the filename on the staged reference and drops the base64", async () => {
      const { service } = fakeStore();
      const messages = [
        {
          role: "assistant",
          content: [
            {
              type: "file",
              file: {
                filename: "report.pdf",
                file_data: "data:application/pdf;base64,JVBERi0xLjQK",
              },
            },
          ],
        },
      ];
      const span = baseSpan([
        { key: "langwatch.output", value: { stringValue: JSON.stringify(messages) } },
      ]);
      const command = baseCommand(span);

      const result = await TraceEdgeMediaExtractionService.maybeExtractSpanMedia({
        data: command,
        deps: baseDeps({ service }),
        logger: silentLogger(),
      });

      const rewritten = result.span.attributes[0]!.value.stringValue!;
      expect(rewritten).not.toContain("base64");
      const part = JSON.parse(rewritten)[0].content[0];
      expect(part.filename).toBe("report.pdf");
    });
  });

  describe("given media nested inside a typed-raw JSON string", () => {
    /** @scenario "Media nested inside a typed-raw JSON string is still found" */
    it("rewrites the nested JSON string in place and preserves the envelope", async () => {
      const { service } = fakeStore();
      const nestedMessages = [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: PNG_DATA_URI } }],
        },
      ];
      const envelope = { type: "raw", value: JSON.stringify(nestedMessages) };
      const span = baseSpan([
        { key: "langwatch.input", value: { stringValue: JSON.stringify(envelope) } },
      ]);
      const command = baseCommand(span);

      const result = await TraceEdgeMediaExtractionService.maybeExtractSpanMedia({
        data: command,
        deps: baseDeps({ service }),
        logger: silentLogger(),
      });

      const rewritten = JSON.parse(result.span.attributes[0]!.value.stringValue!);
      expect(rewritten.type).toBe("raw");
      const innerMessages = JSON.parse(rewritten.value);
      expect(innerMessages[0].content[0].image_url.url).toMatch(/^\/api\/files\/project-1\//);
    });
  });

  describe("given media carried on a span event", () => {
    /** @scenario "Media carried on span events is externalized like span attributes" */
    it("rewrites the event attribute to reference the stored object", async () => {
      const { service } = fakeStore();
      const messages = [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: PNG_DATA_URI } }],
        },
      ];
      const span = baseSpan([{ key: "unrelated", value: { stringValue: "no media here" } }]);
      span.events = [
        {
          timeUnixNano: { low: 0, high: 0 },
          name: "gen_ai.content.prompt",
          attributes: [{ key: "gen_ai.prompt", value: { stringValue: JSON.stringify(messages) } }],
          droppedAttributesCount: 0,
        },
      ];
      const command = baseCommand(span);

      const result = await TraceEdgeMediaExtractionService.maybeExtractSpanMedia({
        data: command,
        deps: baseDeps({ service }),
        logger: silentLogger(),
      });

      const rewritten = result.span.events[0]!.attributes[0]!.value.stringValue!;
      expect(rewritten).not.toContain("base64");
      expect(JSON.parse(rewritten)[0].content[0].image_url.url).toMatch(
        /^\/api\/files\/project-1\//,
      );
    });
  });

  describe("given an Anthropic image block inside a span input", () => {
    /** @scenario "An Anthropic image block inside a span input is externalized before staging" */
    it("references a stored object with no inline base64 data", async () => {
      const { service } = fakeStore();
      const messages = [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" },
            },
          ],
        },
      ];
      const span = baseSpan([
        { key: "langwatch.input", value: { stringValue: JSON.stringify(messages) } },
      ]);
      const command = baseCommand(span);

      const result = await TraceEdgeMediaExtractionService.maybeExtractSpanMedia({
        data: command,
        deps: baseDeps({ service }),
        logger: silentLogger(),
      });

      const rewritten = result.span.attributes[0]!.value.stringValue!;
      expect(rewritten).not.toContain("iVBORw0KGgo=");
      expect(rewritten).toMatch(/\/api\/files\/project-1\//);
    });
  });

  describe("given a Gemini inline-data part inside a span input", () => {
    /** @scenario "A Gemini inline-data part inside a span input is externalized before staging" */
    it("references a stored object with no inline base64 data", async () => {
      const { service } = fakeStore();
      const messages = [
        {
          role: "user",
          content: [{ inline_data: { mime_type: "application/pdf", data: "JVBERi0xLjQK" } }],
        },
      ];
      const span = baseSpan([
        { key: "langwatch.input", value: { stringValue: JSON.stringify(messages) } },
      ]);
      const command = baseCommand(span);

      const result = await TraceEdgeMediaExtractionService.maybeExtractSpanMedia({
        data: command,
        deps: baseDeps({ service }),
        logger: silentLogger(),
      });

      const rewritten = result.span.attributes[0]!.value.stringValue!;
      expect(rewritten).not.toContain("JVBERi0xLjQK");
      expect(rewritten).toMatch(/\/api\/files\/project-1\//);
    });
  });

  describe("given the same bytes already stored under the project", () => {
    /** @scenario "The same recording on a scenario event and on a trace is stored once" */
    it("resolves the trace span's reference to the same stored object id with no second write", async () => {
      const store = fakeStore();
      const { service } = store;
      // Both calls go through the real extraction path (content-addressed
      // by bytes) — the first stands in for the scenario event's earlier
      // write, the second for the byte-identical recording arriving on a
      // trace span.
      const messages = [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: PNG_DATA_URI } }],
        },
      ];
      const firstSpan = baseSpan([
        { key: "langwatch.input", value: { stringValue: JSON.stringify(messages) } },
      ]);
      const firstResult = await TraceEdgeMediaExtractionService.maybeExtractSpanMedia({
        data: baseCommand(firstSpan),
        deps: baseDeps({ service }),
        logger: silentLogger(),
      });
      expect(store.calls).toBe(1);
      const firstId = /\/api\/files\/project-1\/([^"?]+)/.exec(
        firstResult.span.attributes[0]!.value.stringValue!,
      )?.[1];

      const secondSpan = baseSpan([
        { key: "langwatch.input", value: { stringValue: JSON.stringify(messages) } },
      ]);
      secondSpan.spanId = "span-2";
      const secondResult = await TraceEdgeMediaExtractionService.maybeExtractSpanMedia({
        data: baseCommand(secondSpan),
        deps: baseDeps({ service }),
        logger: silentLogger(),
      });

      expect(store.calls).toBe(1); // no second write
      const secondId = /\/api\/files\/project-1\/([^"?]+)/.exec(
        secondResult.span.attributes[0]!.value.stringValue!,
      )?.[1];
      expect(secondId).toBe(firstId);
    });
  });

  describe("given the same bytes in two attributes of one span", () => {
    /** @scenario "The same bytes in two attributes of one span are stored once" */
    it("references the same stored object id from both attributes with one write", async () => {
      const store = fakeStore();
      const { service } = store;
      const messages = [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: PNG_DATA_URI } }],
        },
      ];
      const span = baseSpan([
        { key: "langwatch.input", value: { stringValue: JSON.stringify(messages) } },
        { key: "langwatch.prompt.variables", value: { stringValue: JSON.stringify(messages) } },
      ]);
      const command = baseCommand(span);

      const result = await TraceEdgeMediaExtractionService.maybeExtractSpanMedia({
        data: command,
        deps: baseDeps({ service }),
        logger: silentLogger(),
      });

      expect(store.calls).toBe(1);
      const first = result.span.attributes[0]!.value.stringValue!;
      const second = result.span.attributes[1]!.value.stringValue!;
      const firstId = /\/api\/files\/project-1\/([^"?]+)/.exec(first)?.[1];
      const secondId = /\/api\/files\/project-1\/([^"?]+)/.exec(second)?.[1];
      expect(firstId).toBeTruthy();
      expect(firstId).toBe(secondId);
    });
  });

  describe("given the object store rejects writes", () => {
    /** @scenario "A storage failure falls back to inline ingestion (fail-open)" */
    it("stages the span with its original inline payload and logs the failure", async () => {
      const failingService: TraceMediaStorePort = {
        storeFromBytes: async () => {
          throw new Error("store unavailable");
        },
      } as unknown as TraceMediaStorePort;
      const messages = [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: PNG_DATA_URI } }],
        },
      ];
      const original = JSON.stringify(messages);
      const span = baseSpan([{ key: "langwatch.input", value: { stringValue: original } }]);
      const command = baseCommand(span);
      const telemetry = { failOpen: vi.fn() };
      const logger = silentLogger();

      const result = await TraceEdgeMediaExtractionService.maybeExtractSpanMedia({
        data: command,
        deps: baseDeps({ service: failingService, telemetry }),
        logger,
      });

      expect(result.span.attributes[0]!.value.stringValue).toBe(original);
      expect(telemetry.failOpen).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("given the project's resolved policy drops span content", () => {
    /** @scenario "A project with a content-drop policy skips edge extraction" */
    it("writes no bytes to the object store and leaves the span unchanged", async () => {
      const store = fakeStore();
      const { service } = store;
      const messages = [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: PNG_DATA_URI } }],
        },
      ];
      const original = JSON.stringify(messages);
      const span = baseSpan([{ key: "langwatch.input", value: { stringValue: original } }]);
      const command = baseCommand(span);

      const result = await TraceEdgeMediaExtractionService.maybeExtractSpanMedia({
        data: command,
        deps: baseDeps({ service, hasContentDropRules: async () => true }),
        logger: silentLogger(),
      });

      expect(store.calls).toBe(0);
      expect(result.span.attributes[0]!.value.stringValue).toBe(original);
    });
  });

  describe("given the feature flag is disabled for the project", () => {
    /** @scenario "The flag disabled keeps ingestion byte-identical to today" */
    it("stages the original inline payload and creates no stored object", async () => {
      const store = fakeStore();
      const { service } = store;
      const messages = [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: PNG_DATA_URI } }],
        },
      ];
      const original = JSON.stringify(messages);
      const span = baseSpan([{ key: "langwatch.input", value: { stringValue: original } }]);
      const command = baseCommand(span);

      const result = await TraceEdgeMediaExtractionService.maybeExtractSpanMedia({
        data: command,
        deps: baseDeps({ service, featureFlags: flags(false) }),
        logger: silentLogger(),
      });

      expect(store.calls).toBe(0);
      expect(result.span.attributes[0]!.value.stringValue).toBe(original);
      expect(result).toBe(command);
    });
  });

  describe("given a span whose media was already externalized at the edge", () => {
    /** @scenario "A queue retry after extraction re-stages the already-rewritten command" */
    it("is a no-op the second time extraction runs over it", async () => {
      const store = fakeStore();
      const { service } = store;
      const messages = [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: PNG_DATA_URI } }],
        },
      ];
      const span = baseSpan([
        { key: "langwatch.input", value: { stringValue: JSON.stringify(messages) } },
      ]);
      const command = baseCommand(span);
      const deps = baseDeps({ service });

      const firstPass = await TraceEdgeMediaExtractionService.maybeExtractSpanMedia({
        data: command,
        deps,
        logger: silentLogger(),
      });
      expect(store.calls).toBe(1);

      // Simulates a group-queue retry re-running the hook over the
      // already-rewritten command (idempotent PUT, no marker left to find).
      const secondPass = await TraceEdgeMediaExtractionService.maybeExtractSpanMedia({
        data: firstPass,
        deps,
        logger: silentLogger(),
      });

      expect(store.calls).toBe(1);
      expect(secondPass.span.attributes[0]!.value.stringValue).toBe(
        firstPass.span.attributes[0]!.value.stringValue,
      );
    });
  });
});
