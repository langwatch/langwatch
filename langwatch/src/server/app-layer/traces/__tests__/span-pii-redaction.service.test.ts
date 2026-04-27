import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PIICheckOptions } from "~/server/background/workers/collector/piiCheck";
import type { PIIRedactionLevel } from "../../../event-sourcing/pipelines/trace-processing/schemas/commands";
import type {
  OtlpKeyValue,
  OtlpResource,
  OtlpSpan,
} from "../../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import {
  DEFAULT_PII_REDACTION_MAX_ATTRIBUTE_LENGTH,
  OtlpSpanPiiRedactionService,
  type BatchClearPIIFunction,
} from "../span-pii-redaction.service";

vi.mock("~/server/background/workers/collector/piiCheck", () => ({
  batchPresidioClearPII: vi.fn(),
  googleDLPClearPII: vi.fn(),
}));

function createMockOtlpSpan(attributes: OtlpKeyValue[]): OtlpSpan {
  return {
    traceId: "abc123",
    spanId: "def456",
    name: "test-span",
    kind: 1,
    startTimeUnixNano: { low: 0, high: 0 },
    endTimeUnixNano: { low: 0, high: 0 },
    attributes,
    events: [],
    links: [],
    status: {},
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

function createMockResource(attributes: OtlpKeyValue[]): OtlpResource {
  return { attributes, droppedAttributesCount: 0 };
}

/**
 * Creates a mock batchClearPII function that replaces every input with "[REDACTED]".
 */
function createMockBatchClearPII(): {
  mockBatchClearPII: BatchClearPIIFunction;
  batchSpy: ReturnType<typeof vi.fn>;
} {
  const batchSpy = vi.fn<BatchClearPIIFunction>(async (texts) =>
    texts.map(() => "[REDACTED]"),
  );

  return { mockBatchClearPII: batchSpy, batchSpy };
}

describe("OtlpSpanPiiRedactionService", () => {
  let service: OtlpSpanPiiRedactionService;
  let batchSpy: ReturnType<typeof vi.fn>;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DISABLE_PII_REDACTION;
    const { mockBatchClearPII, batchSpy: spy } = createMockBatchClearPII();
    batchSpy = spy;
    service = new OtlpSpanPiiRedactionService({
      batchClearPII: mockBatchClearPII,
      isLangevalsConfigured: true,
      isProduction: false,
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("redactSpan", () => {
    describe("when DISABLE_PII_REDACTION env var is set", () => {
      it("does not modify the span regardless of redaction level", async () => {
        process.env.DISABLE_PII_REDACTION = "true";
        const span = createMockOtlpSpan([
          { key: "gen_ai.prompt", value: { stringValue: "sensitive data" } },
        ]);
        const originalValue = span.attributes[0]!.value.stringValue;

        await service.redactSpan(span, null, "STRICT");

        expect(span.attributes[0]!.value.stringValue).toBe(originalValue);
        expect(batchSpy).not.toHaveBeenCalled();
      });

      it("skips redaction even for ESSENTIAL level", async () => {
        process.env.DISABLE_PII_REDACTION = "1";
        const span = createMockOtlpSpan([
          { key: "gen_ai.prompt", value: { stringValue: "user@email.com" } },
        ]);
        const originalValue = span.attributes[0]!.value.stringValue;

        await service.redactSpan(span, null, "ESSENTIAL");

        expect(span.attributes[0]!.value.stringValue).toBe(originalValue);
        expect(batchSpy).not.toHaveBeenCalled();
      });
    });

    describe("when piiRedactionLevel is DISABLED", () => {
      it("does not modify the span", async () => {
        const span = createMockOtlpSpan([
          { key: "gen_ai.prompt", value: { stringValue: "sensitive data" } },
        ]);
        const originalValue = span.attributes[0]!.value.stringValue;

        await service.redactSpan(span, null, "DISABLED");

        expect(span.attributes[0]!.value.stringValue).toBe(originalValue);
        expect(batchSpy).not.toHaveBeenCalled();
      });
    });

    describe("when piiRedactionLevel is ESSENTIAL or STRICT", () => {
      it.each(["ESSENTIAL", "STRICT"] as PIIRedactionLevel[])(
        "redacts gen_ai.prompt attribute when level is %s",
        async (level) => {
          const span = createMockOtlpSpan([
            { key: "gen_ai.prompt", value: { stringValue: "user@email.com" } },
          ]);

          await service.redactSpan(span, null, level);

          expect(span.attributes[0]!.value.stringValue).toBe("[REDACTED]");
        },
      );

      it("redacts gen_ai.completion attribute", async () => {
        const span = createMockOtlpSpan([
          {
            key: "gen_ai.completion",
            value: { stringValue: "response with PII" },
          },
        ]);

        await service.redactSpan(span, null, "STRICT");

        expect(span.attributes[0]!.value.stringValue).toBe("[REDACTED]");
      });

      it("redacts gen_ai.input.messages attribute", async () => {
        const span = createMockOtlpSpan([
          {
            key: "gen_ai.input.messages",
            value: { stringValue: '[{"role": "user", "content": "secret"}]' },
          },
        ]);

        await service.redactSpan(span, null, "STRICT");

        expect(span.attributes[0]!.value.stringValue).toBe("[REDACTED]");
      });

      it("redacts gen_ai.output.messages attribute", async () => {
        const span = createMockOtlpSpan([
          {
            key: "gen_ai.output.messages",
            value: {
              stringValue: '[{"role": "assistant", "content": "secret"}]',
            },
          },
        ]);

        await service.redactSpan(span, null, "STRICT");

        expect(span.attributes[0]!.value.stringValue).toBe("[REDACTED]");
      });

      it("redacts all string attributes regardless of key name", async () => {
        const span = createMockOtlpSpan([
          { key: "gen_ai.prompt", value: { stringValue: "prompt PII" } },
          {
            key: "gen_ai.completion",
            value: { stringValue: "completion PII" },
          },
          {
            key: "other.attribute",
            value: { stringValue: "this is also scanned" },
          },
        ]);

        await service.redactSpan(span, null, "STRICT");

        expect(span.attributes[0]!.value.stringValue).toBe("[REDACTED]");
        expect(span.attributes[1]!.value.stringValue).toBe("[REDACTED]");
        expect(span.attributes[2]!.value.stringValue).toBe("[REDACTED]");
      });

      it("redacts SDK-specific attribute keys", async () => {
        const span = createMockOtlpSpan([
          {
            key: "ai.prompt.messages",
            value: { stringValue: "vercel AI content" },
          },
          {
            key: "traceloop.entity.input",
            value: { stringValue: "traceloop content" },
          },
          {
            key: "mastra.agent_run.input",
            value: { stringValue: "mastra content" },
          },
        ]);

        await service.redactSpan(span, null, "STRICT");

        expect(span.attributes[0]!.value.stringValue).toBe("[REDACTED]");
        expect(span.attributes[1]!.value.stringValue).toBe("[REDACTED]");
        expect(span.attributes[2]!.value.stringValue).toBe("[REDACTED]");
      });

      it("sends all string values in a single batch call", async () => {
        const span = createMockOtlpSpan([
          { key: "gen_ai.prompt", value: { stringValue: "first" } },
          { key: "langwatch.input", value: { stringValue: "second" } },
          { key: "other.key", value: { stringValue: "third" } },
        ]);

        await service.redactSpan(span, null, "STRICT");

        expect(batchSpy).toHaveBeenCalledTimes(1);
        expect(batchSpy.mock.calls[0]![0]).toEqual([
          "first",
          "second",
          "third",
        ]);
      });

      it("does not add pii_redaction_status attribute when redaction succeeds", async () => {
        const span = createMockOtlpSpan([
          { key: "gen_ai.prompt", value: { stringValue: "user@email.com" } },
        ]);

        await service.redactSpan(span, null, "STRICT");

        const statusAttr = span.attributes.find(
          (a) => a.key === "langwatch.reserved.pii_redaction_status",
        );
        expect(statusAttr).toBeUndefined();
      });

      it("does not modify non-string attribute values", async () => {
        const span = createMockOtlpSpan([
          { key: "gen_ai.usage.input_tokens", value: { intValue: 123 } },
        ]);

        await service.redactSpan(span, null, "STRICT");

        expect(span.attributes[0]!.value.intValue).toBe(123);
        expect(span.attributes[0]!.value.stringValue).toBeUndefined();
        expect(batchSpy).not.toHaveBeenCalled();
      });

      it("handles attributes with null or undefined stringValue", async () => {
        const span = createMockOtlpSpan([
          { key: "gen_ai.prompt", value: { stringValue: null } },
        ]);

        await expect(
          service.redactSpan(span, null, "STRICT"),
        ).resolves.not.toThrow();
        expect(batchSpy).not.toHaveBeenCalled();
      });

      it("passes correct options to batchClearPII including piiRedactionLevel and mainMethod", async () => {
        const span = createMockOtlpSpan([
          { key: "gen_ai.prompt", value: { stringValue: "test" } },
        ]);

        await service.redactSpan(span, null, "ESSENTIAL");

        expect(batchSpy).toHaveBeenCalledTimes(1);
        const options = batchSpy.mock.calls[0]?.[1] as PIICheckOptions;
        expect(options.piiRedactionLevel).toBe("ESSENTIAL");
        expect(options.mainMethod).toBe("presidio");
      });

      it("does not redact span.name", async () => {
        const span = createMockOtlpSpan([]);

        await service.redactSpan(span, null, "STRICT");

        expect(span.name).toBe("test-span");
      });

      it("redacts string attributes in events", async () => {
        const span = createMockOtlpSpan([]);
        span.events = [
          {
            timeUnixNano: { low: 0, high: 0 },
            name: "event-name",
            attributes: [
              { key: "gen_ai.prompt", value: { stringValue: "event PII" } },
              {
                key: "other.event.attr",
                value: { stringValue: "also scanned" },
              },
            ],
            droppedAttributesCount: 0,
          },
        ];

        await service.redactSpan(span, null, "STRICT");

        expect(span.events[0]!.name).toBe("event-name");
        expect(span.events[0]!.attributes[0]!.value.stringValue).toBe(
          "[REDACTED]",
        );
        expect(span.events[0]!.attributes[1]!.value.stringValue).toBe(
          "[REDACTED]",
        );
      });

      it("redacts status.message", async () => {
        const span = createMockOtlpSpan([]);
        span.status = { message: "error: user john@example.com not found" };

        await service.redactSpan(span, null, "STRICT");

        expect(span.status.message).toBe("[REDACTED]");
      });

      it("redacts string attributes in links", async () => {
        const span = createMockOtlpSpan([]);
        span.links = [
          {
            traceId: "link-trace",
            spanId: "link-span",
            traceState: null,
            attributes: [
              { key: "langwatch.input", value: { stringValue: "link PII" } },
              {
                key: "other.link.attr",
                value: { stringValue: "also scanned" },
              },
            ],
            droppedAttributesCount: 0,
          },
        ];

        await service.redactSpan(span, null, "STRICT");

        expect(span.links[0]!.attributes[0]!.value.stringValue).toBe(
          "[REDACTED]",
        );
        expect(span.links[0]!.attributes[1]!.value.stringValue).toBe(
          "[REDACTED]",
        );
      });

      it("redacts resource attributes", async () => {
        const span = createMockOtlpSpan([
          { key: "gen_ai.prompt", value: { stringValue: "span content" } },
        ]);
        const resource = createMockResource([
          {
            key: "langwatch.metadata.custom",
            value: { stringValue: "sensitive metadata" },
          },
          {
            key: "langwatch.expected_output",
            value: { stringValue: "expected PII" },
          },
        ]);

        await service.redactSpan(span, resource, "STRICT");

        expect(span.attributes[0]!.value.stringValue).toBe("[REDACTED]");
        expect(resource.attributes[0]!.value.stringValue).toBe("[REDACTED]");
        expect(resource.attributes[1]!.value.stringValue).toBe("[REDACTED]");
        // All values sent in a single batch
        expect(batchSpy).toHaveBeenCalledTimes(1);
        expect(batchSpy.mock.calls[0]![0]).toHaveLength(3);
      });

      it("handles null resource", async () => {
        const span = createMockOtlpSpan([
          { key: "gen_ai.prompt", value: { stringValue: "content" } },
        ]);

        await service.redactSpan(span, null, "STRICT");

        expect(span.attributes[0]!.value.stringValue).toBe("[REDACTED]");
      });
    });

    describe("enforced option based on NODE_ENV", () => {
      it("sets enforced to false in test environment (default mock)", async () => {
        const span = createMockOtlpSpan([
          { key: "gen_ai.prompt", value: { stringValue: "test" } },
        ]);

        await service.redactSpan(span, null, "STRICT");

        expect(batchSpy).toHaveBeenCalled();
        const options = batchSpy.mock.calls[0]?.[1] as PIICheckOptions;
        expect(options.enforced).toBe(false);
      });
    });

    describe("error handling", () => {
      it("propagates errors from batchClearPII", async () => {
        const errorBatchClearPII = vi
          .fn()
          .mockRejectedValue(new Error("PII service unavailable"));
        const errorService = new OtlpSpanPiiRedactionService({
          batchClearPII: errorBatchClearPII,
          isLangevalsConfigured: true,
          isProduction: false,
        });
        const span = createMockOtlpSpan([
          { key: "gen_ai.prompt", value: { stringValue: "test" } },
        ]);

        await expect(
          errorService.redactSpan(span, null, "STRICT"),
        ).rejects.toThrow("PII service unavailable");
      });
    });
  });

  describe("when attribute value exceeds maximum length", () => {
    let maxLengthService: OtlpSpanPiiRedactionService;
    let maxLengthBatchSpy: ReturnType<typeof vi.fn>;
    const MAX_LENGTH = 10;

    beforeEach(() => {
      const { mockBatchClearPII, batchSpy: spy } = createMockBatchClearPII();
      maxLengthBatchSpy = spy;
      maxLengthService = new OtlpSpanPiiRedactionService({
        batchClearPII: mockBatchClearPII,
        isLangevalsConfigured: true,
        isProduction: false,
        piiRedactionMaxAttributeLength: MAX_LENGTH,
      });
    });

    it("leaves oversized value unmodified and does not include in batch", async () => {
      const oversizedValue = "x".repeat(MAX_LENGTH + 1);
      const span = createMockOtlpSpan([
        { key: "gen_ai.prompt", value: { stringValue: oversizedValue } },
      ]);

      await maxLengthService.redactSpan(span, null, "STRICT");

      expect(span.attributes[0]!.value.stringValue).toBe(oversizedValue);
      expect(maxLengthBatchSpy).not.toHaveBeenCalled();
    });

    it("sets pii_redaction_status to 'none' when all string attributes exceed max length", async () => {
      const oversizedValue = "x".repeat(MAX_LENGTH + 1);
      const span = createMockOtlpSpan([
        { key: "gen_ai.prompt", value: { stringValue: oversizedValue } },
      ]);

      await maxLengthService.redactSpan(span, null, "STRICT");

      const statusAttr = span.attributes.find(
        (a) => a.key === "langwatch.reserved.pii_redaction_status",
      );
      expect(statusAttr).toBeDefined();
      expect(statusAttr!.value.stringValue).toBe("none");
    });

    it("redacts value at exactly the max length without adding status attribute", async () => {
      const exactValue = "x".repeat(MAX_LENGTH);
      const span = createMockOtlpSpan([
        { key: "gen_ai.prompt", value: { stringValue: exactValue } },
      ]);

      await maxLengthService.redactSpan(span, null, "STRICT");

      expect(span.attributes[0]!.value.stringValue).toBe("[REDACTED]");
      expect(maxLengthBatchSpy).toHaveBeenCalledTimes(1);
      const statusAttr = span.attributes.find(
        (a) => a.key === "langwatch.reserved.pii_redaction_status",
      );
      expect(statusAttr).toBeUndefined();
    });

    it("sets pii_redaction_status to 'partial' when some attributes exceed size and others are redacted", async () => {
      const oversizedValue = "x".repeat(MAX_LENGTH + 1);
      const normalValue = "short";
      const span = createMockOtlpSpan([
        { key: "gen_ai.prompt", value: { stringValue: oversizedValue } },
        { key: "langwatch.input", value: { stringValue: normalValue } },
      ]);

      await maxLengthService.redactSpan(span, null, "STRICT");

      expect(span.attributes[0]!.value.stringValue).toBe(oversizedValue);
      expect(span.attributes[1]!.value.stringValue).toBe("[REDACTED]");
      expect(maxLengthBatchSpy).toHaveBeenCalledTimes(1);
      const statusAttr = span.attributes.find(
        (a) => a.key === "langwatch.reserved.pii_redaction_status",
      );
      expect(statusAttr).toBeDefined();
      expect(statusAttr!.value.stringValue).toBe("partial");
    });

    it("sets pii_redaction_status to 'none' when multiple string attributes all exceed size", async () => {
      const oversized1 = "x".repeat(MAX_LENGTH + 1);
      const oversized2 = "y".repeat(MAX_LENGTH + 5);
      const span = createMockOtlpSpan([
        { key: "gen_ai.prompt", value: { stringValue: oversized1 } },
        { key: "langwatch.input", value: { stringValue: oversized2 } },
      ]);

      await maxLengthService.redactSpan(span, null, "STRICT");

      expect(maxLengthBatchSpy).not.toHaveBeenCalled();
      const statusAttr = span.attributes.find(
        (a) => a.key === "langwatch.reserved.pii_redaction_status",
      );
      expect(statusAttr).toBeDefined();
      expect(statusAttr!.value.stringValue).toBe("none");
    });

    it("skips later values when cumulative batch size exceeds limit", async () => {
      // MAX_LENGTH = 10; two values of 6 chars each = 12 total > 10
      const span = createMockOtlpSpan([
        { key: "attr.a", value: { stringValue: "aaaaaa" } }, // 6 chars, cumulative = 6 (fits)
        { key: "attr.b", value: { stringValue: "bbbbbb" } }, // 6 chars, cumulative would be 12 (skipped)
      ]);

      await maxLengthService.redactSpan(span, null, "STRICT");

      // First fits within budget, second is skipped
      expect(span.attributes[0]!.value.stringValue).toBe("[REDACTED]");
      expect(span.attributes[1]!.value.stringValue).toBe("bbbbbb");
      expect(maxLengthBatchSpy).toHaveBeenCalledTimes(1);
      expect(maxLengthBatchSpy.mock.calls[0]![0]).toEqual(["aaaaaa"]);
      // Should mark as partial since some were redacted and some skipped
      const statusAttr = span.attributes.find(
        (a) => a.key === "langwatch.reserved.pii_redaction_status",
      );
      expect(statusAttr).toBeDefined();
      expect(statusAttr!.value.stringValue).toBe("partial");
    });

    it("applies cumulative budget across span and resource attributes", async () => {
      // MAX_LENGTH = 10; span attr 6 chars + resource attr 6 chars = 12 > 10
      const span = createMockOtlpSpan([
        { key: "span.attr", value: { stringValue: "aaaaaa" } }, // 6 chars
      ]);
      const resource = createMockResource([
        { key: "resource.attr", value: { stringValue: "bbbbbb" } }, // 6 chars, would exceed
      ]);

      await maxLengthService.redactSpan(span, resource, "STRICT");

      expect(span.attributes[0]!.value.stringValue).toBe("[REDACTED]");
      expect(resource.attributes[0]!.value.stringValue).toBe("bbbbbb");
      const statusAttr = span.attributes.find(
        (a) => a.key === "langwatch.reserved.pii_redaction_status",
      );
      expect(statusAttr).toBeDefined();
      expect(statusAttr!.value.stringValue).toBe("partial");
    });

    it("exports the default max attribute length constant", () => {
      expect(DEFAULT_PII_REDACTION_MAX_ATTRIBUTE_LENGTH).toBe(250_000);
    });
  });
});
