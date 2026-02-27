import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PIICheckOptions } from "~/server/background/workers/collector/piiCheck";
import type { PIIRedactionLevel } from "../../../event-sourcing/pipelines/trace-processing/schemas/commands";
import type { OtlpKeyValue, OtlpSpan } from "../../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import {
  DEFAULT_PII_BEARING_ATTRIBUTE_KEYS,
  DEFAULT_PII_REDACTION_MAX_ATTRIBUTE_LENGTH,
  OtlpSpanPiiRedactionService,
  type ClearPIIFunction,
} from "../span-pii-redaction.service";

vi.mock("~/server/background/workers/collector/piiCheck", () => ({
  clearPII: vi.fn(),
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

/**
 * Creates a mock clearPII function that replaces string values with "[REDACTED]".
 */
function createMockClearPII(): {
  mockClearPII: ClearPIIFunction;
  clearPIISpy: ReturnType<typeof vi.fn>;
} {
  const clearPIISpy = vi.fn<ClearPIIFunction>(
    async (
      object: Record<string | number, unknown>,
      keysPath: (string | number)[],
      _options: unknown,
    ) => {
      // Simple mock that replaces string values with "[REDACTED]"
      let current = object as Record<string | number, unknown>;
      for (const key of keysPath.slice(0, -1)) {
        current = current[key] as Record<string | number, unknown>;
        if (!current) return;
      }
      const lastKey = keysPath[keysPath.length - 1]!;
      if (typeof current[lastKey] === "string") {
        current[lastKey] = "[REDACTED]";
      }
    },
  );

  return { mockClearPII: clearPIISpy, clearPIISpy };
}

describe("OtlpSpanPiiRedactionService", () => {
  let service: OtlpSpanPiiRedactionService;
  let clearPIISpy: ReturnType<typeof vi.fn>;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env vars to avoid pollution between tests
    delete process.env.DISABLE_PII_REDACTION;
    const { mockClearPII, clearPIISpy: spy } = createMockClearPII();
    clearPIISpy = spy;
    service = new OtlpSpanPiiRedactionService({
      clearPII: mockClearPII,
      isLangevalsConfigured: true,
      isProduction: false,
    });
  });

  afterEach(() => {
    // Restore original environment
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

        await service.redactSpan(span, "STRICT");

        expect(span.attributes[0]!.value.stringValue).toBe(originalValue);
        expect(clearPIISpy).not.toHaveBeenCalled();
      });

      it("skips redaction even for ESSENTIAL level", async () => {
        process.env.DISABLE_PII_REDACTION = "1";
        const span = createMockOtlpSpan([
          { key: "gen_ai.prompt", value: { stringValue: "user@email.com" } },
        ]);
        const originalValue = span.attributes[0]!.value.stringValue;

        await service.redactSpan(span, "ESSENTIAL");

        expect(span.attributes[0]!.value.stringValue).toBe(originalValue);
        expect(clearPIISpy).not.toHaveBeenCalled();
      });
    });

    describe("when piiRedactionLevel is DISABLED", () => {
      it("does not modify the span", async () => {
        const span = createMockOtlpSpan([
          { key: "gen_ai.prompt", value: { stringValue: "sensitive data" } },
        ]);
        const originalValue = span.attributes[0]!.value.stringValue;

        await service.redactSpan(span, "DISABLED");

        expect(span.attributes[0]!.value.stringValue).toBe(originalValue);
        expect(clearPIISpy).not.toHaveBeenCalled();
      });
    });

    describe("when piiRedactionLevel is ESSENTIAL or STRICT", () => {
      it.each(["ESSENTIAL", "STRICT"] as PIIRedactionLevel[])(
        "redacts gen_ai.prompt attribute when level is %s",
        async (level) => {
          const span = createMockOtlpSpan([
            { key: "gen_ai.prompt", value: { stringValue: "user@email.com" } },
          ]);

          await service.redactSpan(span, level);

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

        await service.redactSpan(span, "STRICT");

        expect(span.attributes[0]!.value.stringValue).toBe("[REDACTED]");
      });

      it("redacts gen_ai.input.messages attribute", async () => {
        const span = createMockOtlpSpan([
          {
            key: "gen_ai.input.messages",
            value: { stringValue: '[{"role": "user", "content": "secret"}]' },
          },
        ]);

        await service.redactSpan(span, "STRICT");

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

        await service.redactSpan(span, "STRICT");

        expect(span.attributes[0]!.value.stringValue).toBe("[REDACTED]");
      });

      it("redacts gen_ai.request.input_messages attribute (latest semconv)", async () => {
        const span = createMockOtlpSpan([
          {
            key: "gen_ai.request.input_messages",
            value: { stringValue: "request messages PII" },
          },
        ]);

        await service.redactSpan(span, "STRICT");

        expect(span.attributes[0]!.value.stringValue).toBe("[REDACTED]");
      });

      it("redacts gen_ai.response.output_messages attribute (latest semconv)", async () => {
        const span = createMockOtlpSpan([
          {
            key: "gen_ai.response.output_messages",
            value: { stringValue: "response messages PII" },
          },
        ]);

        await service.redactSpan(span, "STRICT");

        expect(span.attributes[0]!.value.stringValue).toBe("[REDACTED]");
      });

      it("redacts langwatch.input attribute", async () => {
        const span = createMockOtlpSpan([
          { key: "langwatch.input", value: { stringValue: "input with PII" } },
        ]);

        await service.redactSpan(span, "STRICT");

        expect(span.attributes[0]!.value.stringValue).toBe("[REDACTED]");
      });

      it("redacts langwatch.output attribute", async () => {
        const span = createMockOtlpSpan([
          {
            key: "langwatch.output",
            value: { stringValue: "output with PII" },
          },
        ]);

        await service.redactSpan(span, "STRICT");

        expect(span.attributes[0]!.value.stringValue).toBe("[REDACTED]");
      });

      it("redacts input.value attribute", async () => {
        const span = createMockOtlpSpan([
          { key: "input.value", value: { stringValue: "input value PII" } },
        ]);

        await service.redactSpan(span, "STRICT");

        expect(span.attributes[0]!.value.stringValue).toBe("[REDACTED]");
      });

      it("redacts output.value attribute", async () => {
        const span = createMockOtlpSpan([
          { key: "output.value", value: { stringValue: "output value PII" } },
        ]);

        await service.redactSpan(span, "STRICT");

        expect(span.attributes[0]!.value.stringValue).toBe("[REDACTED]");
      });

      it("only redacts PII-bearing attribute keys, not other attributes", async () => {
        const span = createMockOtlpSpan([
          { key: "gen_ai.prompt", value: { stringValue: "prompt PII" } },
          {
            key: "gen_ai.completion",
            value: { stringValue: "completion PII" },
          },
          {
            key: "other.attribute",
            value: { stringValue: "this should NOT be scanned" },
          },
        ]);

        await service.redactSpan(span, "STRICT");

        // Only PII-bearing keys are redacted
        expect(span.attributes[0]!.value.stringValue).toBe("[REDACTED]");
        expect(span.attributes[1]!.value.stringValue).toBe("[REDACTED]");
        // Non-PII-bearing keys remain unchanged
        expect(span.attributes[2]!.value.stringValue).toBe(
          "this should NOT be scanned",
        );
      });

      it("does not modify non-string attribute values", async () => {
        const span = createMockOtlpSpan([
          { key: "gen_ai.prompt", value: { intValue: 123 } },
        ]);

        await service.redactSpan(span, "STRICT");

        // Non-string values remain unchanged
        expect(span.attributes[0]!.value.intValue).toBe(123);
        expect(span.attributes[0]!.value.stringValue).toBeUndefined();
        // clearPII should not be called for non-string values
        expect(clearPIISpy).not.toHaveBeenCalled();
      });

      it("handles attributes with null or undefined stringValue", async () => {
        const span = createMockOtlpSpan([
          { key: "gen_ai.prompt", value: { stringValue: null } },
        ]);

        // Should not throw
        await expect(service.redactSpan(span, "STRICT")).resolves.not.toThrow();
        // clearPII should not be called for null stringValue
        expect(clearPIISpy).not.toHaveBeenCalled();
      });

      it("passes correct options to clearPII including piiRedactionLevel and mainMethod", async () => {
        const span = createMockOtlpSpan([
          { key: "gen_ai.prompt", value: { stringValue: "test" } },
        ]);

        await service.redactSpan(span, "ESSENTIAL");

        expect(clearPIISpy).toHaveBeenCalledTimes(1);
        const options = clearPIISpy.mock.calls[0]?.[2] as PIICheckOptions;
        expect(options.piiRedactionLevel).toBe("ESSENTIAL");
        expect(options.mainMethod).toBe("presidio");
      });

      it("does not redact span.name (only scans specific attribute keys)", async () => {
        const span = createMockOtlpSpan([]);

        await service.redactSpan(span, "STRICT");

        expect(span.name).toBe("test-span");
      });

      it("redacts PII-bearing attributes in events", async () => {
        const span = createMockOtlpSpan([]);
        span.events = [
          {
            timeUnixNano: { low: 0, high: 0 },
            name: "event-name",
            attributes: [
              { key: "gen_ai.prompt", value: { stringValue: "event PII" } },
              {
                key: "other.event.attr",
                value: { stringValue: "not scanned" },
              },
            ],
            droppedAttributesCount: 0,
          },
        ];

        await service.redactSpan(span, "STRICT");

        // Event name is not redacted
        expect(span.events[0]!.name).toBe("event-name");
        // PII-bearing attribute is redacted
        expect(span.events[0]!.attributes[0]!.value.stringValue).toBe(
          "[REDACTED]",
        );
        // Non-PII-bearing attribute is not redacted
        expect(span.events[0]!.attributes[1]!.value.stringValue).toBe(
          "not scanned",
        );
      });

      it("does not redact status.message (only scans specific attribute keys)", async () => {
        const span = createMockOtlpSpan([]);
        span.status = { message: "error message" };

        await service.redactSpan(span, "STRICT");

        expect(span.status.message).toBe("error message");
      });

      it("redacts PII-bearing attributes in links", async () => {
        const span = createMockOtlpSpan([]);
        span.links = [
          {
            traceId: "link-trace",
            spanId: "link-span",
            traceState: null,
            attributes: [
              { key: "langwatch.input", value: { stringValue: "link PII" } },
              { key: "other.link.attr", value: { stringValue: "not scanned" } },
            ],
            droppedAttributesCount: 0,
          },
        ];

        await service.redactSpan(span, "STRICT");

        // PII-bearing attribute is redacted
        expect(span.links[0]!.attributes[0]!.value.stringValue).toBe(
          "[REDACTED]",
        );
        // Non-PII-bearing attribute is not redacted
        expect(span.links[0]!.attributes[1]!.value.stringValue).toBe(
          "not scanned",
        );
      });
    });

    describe("enforced option based on NODE_ENV", () => {
      it("sets enforced to false in test environment (default mock)", async () => {
        // The mock sets NODE_ENV to "test" by default
        const span = createMockOtlpSpan([
          { key: "gen_ai.prompt", value: { stringValue: "test" } },
        ]);

        await service.redactSpan(span, "STRICT");

        expect(clearPIISpy).toHaveBeenCalled();
        const options = clearPIISpy.mock.calls[0]?.[2] as PIICheckOptions;
        expect(options.enforced).toBe(false);
      });

      // Note: Testing enforced=true for production requires module isolation
      // which is complex with vitest. The behavior is verified by code review:
      // env.NODE_ENV === "production" sets enforced: true
    });

    describe("error handling", () => {
      it("propagates errors from clearPII", async () => {
        const errorClearPII = vi
          .fn()
          .mockRejectedValue(new Error("PII service unavailable"));
        const errorService = new OtlpSpanPiiRedactionService({
          clearPII: errorClearPII,
          piiBearingAttributeKeys: DEFAULT_PII_BEARING_ATTRIBUTE_KEYS,
          isLangevalsConfigured: true,
          isProduction: false,
        });
        const span = createMockOtlpSpan([
          { key: "gen_ai.prompt", value: { stringValue: "test" } },
        ]);

        await expect(errorService.redactSpan(span, "STRICT")).rejects.toThrow(
          "PII service unavailable",
        );
      });
    });
  });

  describe("configurable PII-bearing attribute keys", () => {
    it("uses custom attribute keys when provided", async () => {
      const customKeys = new Set(["custom.pii.field"]);
      const { mockClearPII, clearPIISpy } = createMockClearPII();

      const customService = new OtlpSpanPiiRedactionService({
        clearPII: mockClearPII,
        piiBearingAttributeKeys: customKeys,
        isLangevalsConfigured: true,
        isProduction: false,
      });

      const span = createMockOtlpSpan([
        { key: "custom.pii.field", value: { stringValue: "sensitive" } },
        {
          key: "gen_ai.prompt",
          value: { stringValue: "should not be scanned" },
        },
      ]);

      await customService.redactSpan(span, "STRICT");

      // Only custom key should be scanned
      expect(clearPIISpy).toHaveBeenCalledTimes(1);
      expect(span.attributes[0]!.value.stringValue).toBe("[REDACTED]");
      expect(span.attributes[1]!.value.stringValue).toBe(
        "should not be scanned",
      );
    });

    it("exports default keys for extension", () => {
      expect(DEFAULT_PII_BEARING_ATTRIBUTE_KEYS).toContain("gen_ai.prompt");
      expect(DEFAULT_PII_BEARING_ATTRIBUTE_KEYS).toContain("langwatch.input");
    });
  });

  describe("when attribute value exceeds maximum length", () => {
    let maxLengthService: OtlpSpanPiiRedactionService;
    let maxLengthClearPIISpy: ReturnType<typeof vi.fn>;
    const MAX_LENGTH = 10;

    beforeEach(() => {
      const { mockClearPII, clearPIISpy: spy } = createMockClearPII();
      maxLengthClearPIISpy = spy;
      maxLengthService = new OtlpSpanPiiRedactionService({
        clearPII: mockClearPII,
        isLangevalsConfigured: true,
        isProduction: false,
        piiRedactionMaxAttributeLength: MAX_LENGTH,
      });
    });

    it("leaves oversized value unmodified and does not call clearPII", async () => {
      const oversizedValue = "x".repeat(MAX_LENGTH + 1);
      const span = createMockOtlpSpan([
        { key: "gen_ai.prompt", value: { stringValue: oversizedValue } },
      ]);

      await maxLengthService.redactSpan(span, "STRICT");

      expect(span.attributes[0]!.value.stringValue).toBe(oversizedValue);
      expect(maxLengthClearPIISpy).not.toHaveBeenCalled();
    });

    it("redacts value at exactly the max length", async () => {
      const exactValue = "x".repeat(MAX_LENGTH);
      const span = createMockOtlpSpan([
        { key: "gen_ai.prompt", value: { stringValue: exactValue } },
      ]);

      await maxLengthService.redactSpan(span, "STRICT");

      expect(span.attributes[0]!.value.stringValue).toBe("[REDACTED]");
      expect(maxLengthClearPIISpy).toHaveBeenCalledTimes(1);
    });

    it("skips oversized values but still redacts normal values", async () => {
      const oversizedValue = "x".repeat(MAX_LENGTH + 1);
      const normalValue = "short";
      const span = createMockOtlpSpan([
        { key: "gen_ai.prompt", value: { stringValue: oversizedValue } },
        { key: "langwatch.input", value: { stringValue: normalValue } },
      ]);

      await maxLengthService.redactSpan(span, "STRICT");

      expect(span.attributes[0]!.value.stringValue).toBe(oversizedValue);
      expect(span.attributes[1]!.value.stringValue).toBe("[REDACTED]");
      expect(maxLengthClearPIISpy).toHaveBeenCalledTimes(1);
    });

    it("exports the default max attribute length constant", () => {
      expect(DEFAULT_PII_REDACTION_MAX_ATTRIBUTE_LENGTH).toBe(250_000);
    });
  });
});
