import { describe, expect, it } from "vitest";
import type { SpanData } from "../../schemas/commands";
import { traceAttributesService } from "../traceAttributesService";

function createSpan(
  spanId: string,
  attributes: Record<
    string,
    string | number | boolean | string[] | number[] | boolean[]
  > = {},
  resourceAttributes: Record<
    string,
    string | number | boolean | string[] | number[] | boolean[]
  > = {},
): SpanData {
  return {
    id: `span:${spanId}`,
    aggregateId: "trace:test",
    tenantId: "project_test",
    traceId: "test-trace-id",
    spanId,
    traceFlags: 0,
    traceState: null,
    isRemote: false,
    parentSpanId: null,
    name: "test-span",
    kind: 1,
    startTimeUnixMs: 1000,
    endTimeUnixMs: 2000,
    attributes,
    events: [],
    links: [],
    status: { code: 1, message: null },
    resourceAttributes,
    instrumentationScope: { name: "test", version: null },
    durationMs: 1000,
    ended: true,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

describe("TraceAttributesService", () => {
  describe("extract", () => {
    describe("when extracting thread ID", () => {
      it("extracts from gen_ai.conversation.id", () => {
        const spans = [
          createSpan("span1", { "gen_ai.conversation.id": "thread-123" }),
        ];

        const result = traceAttributesService.extract(spans);

        expect(result.threadId).toBe("thread-123");
      });

      it("uses later span value when multiple spans have thread ID", () => {
        const spans = [
          createSpan("span1", { "gen_ai.conversation.id": "thread-first" }),
          createSpan("span2", { "gen_ai.conversation.id": "thread-last" }),
        ];

        const result = traceAttributesService.extract(spans);

        expect(result.threadId).toBe("thread-last");
      });
    });

    describe("when extracting user ID", () => {
      it("extracts from langwatch.user.id", () => {
        const spans = [
          createSpan("span1", { "langwatch.user.id": "user-789" }),
        ];

        const result = traceAttributesService.extract(spans);

        expect(result.userId).toBe("user-789");
      });

      it("uses later span value when multiple spans have user ID", () => {
        const spans = [
          createSpan("span1", { "langwatch.user.id": "user-first" }),
          createSpan("span2", { "langwatch.user.id": "user-last" }),
        ];

        const result = traceAttributesService.extract(spans);

        expect(result.userId).toBe("user-last");
      });
    });

    describe("when extracting customer ID", () => {
      it("extracts from langwatch.customer.id", () => {
        const spans = [
          createSpan("span1", { "langwatch.customer.id": "customer-abc" }),
        ];

        const result = traceAttributesService.extract(spans);

        expect(result.customerId).toBe("customer-abc");
      });
    });

    describe("when extracting labels", () => {
      it("extracts from langwatch.labels array", () => {
        const spans = [
          createSpan("span1", { "langwatch.labels": ["production", "api"] }),
        ];

        const result = traceAttributesService.extract(spans);

        expect(result.labels).toEqual(["api", "production"]);
      });

      it("aggregates labels across spans", () => {
        const spans = [
          createSpan("span1", { "langwatch.labels": ["production", "api"] }),
          createSpan("span2", { "langwatch.labels": ["experimental", "api"] }),
        ];

        const result = traceAttributesService.extract(spans);

        expect(result.labels).toEqual(["api", "experimental", "production"]);
      });

      it("removes duplicate labels", () => {
        const spans = [
          createSpan("span1", { "langwatch.labels": ["api", "production"] }),
          createSpan("span2", { "langwatch.labels": ["api", "production"] }),
        ];

        const result = traceAttributesService.extract(spans);

        expect(result.labels).toEqual(["api", "production"]);
      });

      it("returns sorted labels", () => {
        const spans = [
          createSpan("span1", {
            "langwatch.labels": ["zebra", "alpha", "beta"],
          }),
        ];

        const result = traceAttributesService.extract(spans);

        expect(result.labels).toEqual(["alpha", "beta", "zebra"]);
      });
    });

    describe("when extracting SDK information", () => {
      it("extracts SDK name from resource attributes", () => {
        const spans = [
          createSpan("span1", {}, { "telemetry.sdk.name": "langwatch-sdk" }),
        ];

        const result = traceAttributesService.extract(spans);

        expect(result.sdkName).toBe("langwatch-sdk");
      });

      it("extracts SDK version from resource attributes", () => {
        const spans = [
          createSpan("span1", {}, { "telemetry.sdk.version": "1.2.3" }),
        ];

        const result = traceAttributesService.extract(spans);

        expect(result.sdkVersion).toBe("1.2.3");
      });

      it("extracts SDK language from resource attributes", () => {
        const spans = [
          createSpan("span1", {}, { "telemetry.sdk.language": "typescript" }),
        ];

        const result = traceAttributesService.extract(spans);

        expect(result.sdkLanguage).toBe("typescript");
      });

      it("first span wins for SDK information", () => {
        const spans = [
          createSpan("span1", {}, { "telemetry.sdk.name": "first-sdk" }),
          createSpan("span2", {}, { "telemetry.sdk.name": "second-sdk" }),
        ];

        const result = traceAttributesService.extract(spans);

        expect(result.sdkName).toBe("first-sdk");
      });
    });

    describe("when extracting prompt IDs", () => {
      it("extracts from langwatch.prompt.id", () => {
        const spans = [
          createSpan("span1", { "langwatch.prompt.id": "prompt-123" }),
        ];

        const result = traceAttributesService.extract(spans);

        expect(result.promptIds).toEqual(["prompt-123"]);
      });

      it("aggregates prompt IDs across spans", () => {
        const spans = [
          createSpan("span1", { "langwatch.prompt.id": "prompt-123" }),
          createSpan("span2", { "langwatch.prompt.id": "prompt-456" }),
        ];

        const result = traceAttributesService.extract(spans);

        expect(result.promptIds).toEqual(["prompt-123", "prompt-456"]);
      });

      it("removes duplicate prompt IDs", () => {
        const spans = [
          createSpan("span1", { "langwatch.prompt.id": "prompt-123" }),
          createSpan("span2", { "langwatch.prompt.id": "prompt-123" }),
        ];

        const result = traceAttributesService.extract(spans);

        expect(result.promptIds).toEqual(["prompt-123"]);
      });
    });

    describe("when extracting prompt version IDs", () => {
      it("extracts from langwatch.prompt.version.id", () => {
        const spans = [
          createSpan("span1", { "langwatch.prompt.version.id": "version-abc" }),
        ];

        const result = traceAttributesService.extract(spans);

        expect(result.promptVersionIds).toEqual(["version-abc"]);
      });

      it("aggregates prompt version IDs across spans", () => {
        const spans = [
          createSpan("span1", { "langwatch.prompt.version.id": "version-abc" }),
          createSpan("span2", { "langwatch.prompt.version.id": "version-xyz" }),
        ];

        const result = traceAttributesService.extract(spans);

        expect(result.promptVersionIds).toEqual(["version-abc", "version-xyz"]);
      });
    });

    describe("when extracting selected prompt ID", () => {
      it("extracts from langwatch.prompt.selected.id", () => {
        const spans = [
          createSpan("span1", {
            "langwatch.prompt.selected.id": "selected-prompt-123",
          }),
        ];

        const result = traceAttributesService.extract(spans);

        expect(result.selectedPromptId).toBe("selected-prompt-123");
      });

      it("uses later span value when multiple spans have selected prompt ID", () => {
        const spans = [
          createSpan("span1", {
            "langwatch.prompt.selected.id": "selected-first",
          }),
          createSpan("span2", {
            "langwatch.prompt.selected.id": "selected-last",
          }),
        ];

        const result = traceAttributesService.extract(spans);

        expect(result.selectedPromptId).toBe("selected-last");
      });
    });

    describe("when spans have no attributes", () => {
      it("returns null for all singular fields", () => {
        const spans = [createSpan("span1")];

        const result = traceAttributesService.extract(spans);

        expect(result.threadId).toBeNull();
        expect(result.userId).toBeNull();
        expect(result.customerId).toBeNull();
        expect(result.sdkName).toBeNull();
        expect(result.sdkVersion).toBeNull();
        expect(result.sdkLanguage).toBeNull();
        expect(result.selectedPromptId).toBeNull();
      });

      it("returns empty arrays for collection fields", () => {
        const spans = [createSpan("span1")];

        const result = traceAttributesService.extract(spans);

        expect(result.labels).toEqual([]);
        expect(result.promptIds).toEqual([]);
        expect(result.promptVersionIds).toEqual([]);
      });
    });
  });
});
