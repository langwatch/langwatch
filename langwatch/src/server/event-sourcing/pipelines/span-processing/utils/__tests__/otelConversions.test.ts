import { describe, it, expect } from "vitest";
import { SpanKind } from "@opentelemetry/api";
import type { DeepPartial } from "../../../../../../utils/types";
import type { IAnyValue, IKeyValue } from "@opentelemetry/otlp-transformer";
import { ESpanKind } from "@opentelemetry/otlp-transformer";
import {
  unixNanoToMs,
  msToUnixNano,
  convertSpanKind,
  convertSpanTypeToGenAiOperationName,
  otelValueToOTelValue,
  otelValueToJs,
  otelAttributesToRecord,
  type SpanType,
  type Milliseconds,
} from "../otelConversions";

describe("unixNanoToMs", () => {
  describe("when input is undefined", () => {
    it("returns undefined", () => {
      const result = unixNanoToMs(undefined);
      expect(result).toBeUndefined();
    });
  });

  describe("when input is null", () => {
    it("returns undefined", () => {
      const result = unixNanoToMs(null as any);
      expect(result).toBeUndefined();
    });
  });

  describe("when input is number", () => {
    it("converts nanoseconds to milliseconds", () => {
      const result = unixNanoToMs(1_000_000);
      expect(result).toBe(1);
    });

    it("rounds to nearest millisecond", () => {
      const result = unixNanoToMs(1_500_000);
      expect(result).toBe(2);
    });
  });

  describe("when input is string", () => {
    it("parses string number and converts to milliseconds", () => {
      const result = unixNanoToMs("2000000");
      expect(result).toBe(2);
    });

    it("returns undefined for invalid string", () => {
      const result = unixNanoToMs("invalid");
      expect(result).toBeUndefined();
    });
  });

  describe("when input is Long object with high/low", () => {
    it("converts Long object to milliseconds", () => {
      const longObj = { high: 0, low: 1_000_000 };
      const result = unixNanoToMs(longObj as any);
      expect(result).toBe(1);
    });

    it("handles high/low correctly", () => {
      const longObj = { high: 1, low: 0 };
      const result = unixNanoToMs(longObj as any);
      expect(result).toBe(4295);
    });
  });
});

describe("msToUnixNano", () => {
  describe("when input is undefined", () => {
    it("returns undefined", () => {
      const result = msToUnixNano(undefined);
      expect(result).toBeUndefined();
    });
  });

  describe("when input is valid milliseconds", () => {
    it("converts milliseconds to [seconds, nanoseconds] tuple", () => {
      const result = msToUnixNano(1000 as Milliseconds);
      expect(result).toEqual([1, 0]);
    });

    it("handles integer milliseconds", () => {
      const result = msToUnixNano(1500 as Milliseconds);
      expect(result).toEqual([1, 500000000]);
    });
  });
});

describe("convertSpanKind", () => {
  describe("when originalKind is provided", () => {
    describe("when originalKind is SERVER", () => {
      it("returns SpanKind.SERVER", () => {
        const result = convertSpanKind(
          "span" as SpanType,
          ESpanKind.SPAN_KIND_SERVER,
        );
        expect(result).toBe(SpanKind.SERVER);
      });
    });

    describe("when originalKind is CLIENT", () => {
      it("returns SpanKind.CLIENT", () => {
        const result = convertSpanKind(
          "client" as SpanType,
          ESpanKind.SPAN_KIND_CLIENT,
        );
        expect(result).toBe(SpanKind.CLIENT);
      });
    });

    describe("when originalKind is PRODUCER", () => {
      it("returns SpanKind.PRODUCER", () => {
        const result = convertSpanKind(
          "producer" as SpanType,
          ESpanKind.SPAN_KIND_PRODUCER,
        );
        expect(result).toBe(SpanKind.PRODUCER);
      });
    });

    describe("when originalKind is CONSUMER", () => {
      it("returns SpanKind.CONSUMER", () => {
        const result = convertSpanKind(
          "consumer" as SpanType,
          ESpanKind.SPAN_KIND_CONSUMER,
        );
        expect(result).toBe(SpanKind.CONSUMER);
      });
    });

    describe("when originalKind is INTERNAL", () => {
      it("returns SpanKind.INTERNAL", () => {
        const result = convertSpanKind(
          "span" as SpanType,
          ESpanKind.SPAN_KIND_INTERNAL,
        );
        expect(result).toBe(SpanKind.INTERNAL);
      });
    });
  });

  describe("when originalKind is undefined", () => {
    it("falls back to type-based mapping for server", () => {
      const result = convertSpanKind("server" as SpanType, undefined);
      expect(result).toBe(SpanKind.SERVER);
    });

    it("falls back to type-based mapping for client", () => {
      const result = convertSpanKind("client" as SpanType, undefined);
      expect(result).toBe(SpanKind.CLIENT);
    });

    it("falls back to type-based mapping for producer", () => {
      const result = convertSpanKind("producer" as SpanType, undefined);
      expect(result).toBe(SpanKind.PRODUCER);
    });

    it("falls back to type-based mapping for consumer", () => {
      const result = convertSpanKind("consumer" as SpanType, undefined);
      expect(result).toBe(SpanKind.CONSUMER);
    });

    it("defaults to INTERNAL for unknown types", () => {
      const result = convertSpanKind("unknown" as SpanType, undefined);
      expect(result).toBe(SpanKind.INTERNAL);
    });

    it("defaults to INTERNAL for span type", () => {
      const result = convertSpanKind("span" as SpanType, undefined);
      expect(result).toBe(SpanKind.INTERNAL);
    });
  });
});

describe("convertSpanTypeToGenAiOperationName", () => {
  it("maps llm to chat", () => {
    const result = convertSpanTypeToGenAiOperationName("llm");
    expect(result).toBe("chat");
  });

  it("maps agent to invoke_agent", () => {
    const result = convertSpanTypeToGenAiOperationName("agent");
    expect(result).toBe("invoke_agent");
  });

  it("maps tool to execute_tool", () => {
    const result = convertSpanTypeToGenAiOperationName("tool");
    expect(result).toBe("execute_tool");
  });

  it("maps rag to embeddings", () => {
    const result = convertSpanTypeToGenAiOperationName("rag");
    expect(result).toBe("embeddings");
  });

  it("maps chain to invoke_chain", () => {
    const result = convertSpanTypeToGenAiOperationName("chain");
    expect(result).toBe("invoke_chain");
  });

  it("maps guardrail to check_guardrail", () => {
    const result = convertSpanTypeToGenAiOperationName("guardrail");
    expect(result).toBe("check_guardrail");
  });

  it("maps evaluation to evaluate", () => {
    const result = convertSpanTypeToGenAiOperationName("evaluation");
    expect(result).toBe("evaluate");
  });

  it("maps workflow to execute_workflow", () => {
    const result = convertSpanTypeToGenAiOperationName("workflow");
    expect(result).toBe("execute_workflow");
  });

  it("maps component to execute_component", () => {
    const result = convertSpanTypeToGenAiOperationName("component");
    expect(result).toBe("execute_component");
  });

  it("maps module to execute_module", () => {
    const result = convertSpanTypeToGenAiOperationName("module");
    expect(result).toBe("execute_module");
  });

  it("maps task to execute_task", () => {
    const result = convertSpanTypeToGenAiOperationName("task");
    expect(result).toBe("execute_task");
  });

  it("returns undefined for unknown types", () => {
    const result = convertSpanTypeToGenAiOperationName("unknown" as SpanType);
    expect(result).toBeUndefined();
  });
});

describe("otelValueToOTelValue", () => {
  describe("when value is undefined", () => {
    it("returns undefined", () => {
      const result = otelValueToOTelValue(undefined);
      expect(result).toBeUndefined();
    });
  });

  describe("when value has stringValue", () => {
    it("returns string type", () => {
      const value: DeepPartial<IAnyValue> = { stringValue: "test" };
      const result = otelValueToOTelValue(value);
      expect(result).toEqual({ type: "string", value: "test" });
    });
  });

  describe("when value has boolValue", () => {
    it("returns bool type", () => {
      const value: DeepPartial<IAnyValue> = { boolValue: true };
      const result = otelValueToOTelValue(value);
      expect(result).toEqual({ type: "bool", value: true });
    });
  });

  describe("when value has intValue as number", () => {
    it("returns int type", () => {
      const value: DeepPartial<IAnyValue> = { intValue: 42 };
      const result = otelValueToOTelValue(value);
      expect(result).toEqual({ type: "int", value: 42 });
    });
  });

  describe("when value has intValue as Long object", () => {
    it("returns int type with converted value", () => {
      const longObj = { toInt: () => 100 };
      const value: DeepPartial<IAnyValue> = { intValue: longObj as any };
      const result = otelValueToOTelValue(value);
      expect(result).toEqual({ type: "int", value: 100 });
    });
  });

  describe("when value has doubleValue as number", () => {
    it("returns double type", () => {
      const value: DeepPartial<IAnyValue> = { doubleValue: 3.14 };
      const result = otelValueToOTelValue(value);
      expect(result).toEqual({ type: "double", value: 3.14 });
    });
  });

  describe("when value has doubleValue as Long object", () => {
    it("returns double type with converted value", () => {
      const longObj = { toNumber: () => 2.71 };
      const value: DeepPartial<IAnyValue> = { doubleValue: longObj as any };
      const result = otelValueToOTelValue(value);
      expect(result).toEqual({ type: "double", value: 2.71 });
    });
  });

  describe("when value has arrayValue", () => {
    it("returns array type with converted values", () => {
      const value: DeepPartial<IAnyValue> = {
        arrayValue: {
          values: [
            { stringValue: "hello" },
            { intValue: 42 },
            { boolValue: true },
          ],
        },
      };
      const result = otelValueToOTelValue(value);
      expect(result).toEqual({
        type: "array",
        value: ["hello", 42, true],
      });
    });
  });

  describe("when value has kvlistValue", () => {
    it("returns kvlist type with converted values", () => {
      const value: DeepPartial<IAnyValue> = {
        kvlistValue: {
          values: [
            { key: "name", value: { stringValue: "test" } },
            { key: "count", value: { intValue: 10 } },
          ],
        },
      };
      const result = otelValueToOTelValue(value);
      expect(result).toEqual({
        type: "kvlist",
        value: { name: "test", count: 10 },
      });
    });
  });
});

describe("otelValueToJs", () => {
  it("delegates to otelValueToOTelValue and extracts value", () => {
    const value: DeepPartial<IAnyValue> = { stringValue: "test" };
    const result = otelValueToJs(value);
    expect(result).toBe("test");
  });

  it("returns undefined when otelValueToOTelValue returns undefined", () => {
    const result = otelValueToJs(undefined);
    expect(result).toBeUndefined();
  });
});

describe("otelAttributesToRecord", () => {
  describe("when attributes is undefined", () => {
    it("returns empty record", () => {
      const result = otelAttributesToRecord(undefined);
      expect(result).toEqual({});
    });
  });

  describe("when attributes array is empty", () => {
    it("returns empty record", () => {
      const result = otelAttributesToRecord([]);
      expect(result).toEqual({});
    });
  });

  describe("when attributes have valid values", () => {
    it("includes string attributes", () => {
      const attributes: DeepPartial<IKeyValue[]> = [
        { key: "name", value: { stringValue: "test" } },
      ];
      const result = otelAttributesToRecord(attributes);
      expect(result).toEqual({ name: "test" });
    });

    it("includes number attributes", () => {
      const attributes: DeepPartial<IKeyValue[]> = [
        { key: "count", value: { intValue: 42 } },
      ];
      const result = otelAttributesToRecord(attributes);
      expect(result).toEqual({ count: 42 });
    });

    it("includes boolean attributes", () => {
      const attributes: DeepPartial<IKeyValue[]> = [
        { key: "enabled", value: { boolValue: true } },
      ];
      const result = otelAttributesToRecord(attributes);
      expect(result).toEqual({ enabled: true });
    });

    it("includes valid array attributes", () => {
      const attributes: DeepPartial<IKeyValue[]> = [
        {
          key: "tags",
          value: {
            arrayValue: {
              values: [{ stringValue: "tag1" }, { stringValue: "tag2" }],
            },
          },
        },
      ];
      const result = otelAttributesToRecord(attributes);
      expect(result).toEqual({ tags: ["tag1", "tag2"] });
    });

    it("excludes kvlist attributes", () => {
      const attributes: DeepPartial<IKeyValue[]> = [
        {
          key: "kvlist_attr",
          value: {
            kvlistValue: {
              values: [{ key: "nested", value: { stringValue: "value" } }],
            },
          },
        },
      ];
      const result = otelAttributesToRecord(attributes);
      expect(result).toEqual({});
    });

    it("skips attributes without key", () => {
      const attributes: DeepPartial<IKeyValue[]> = [
        { value: { stringValue: "no-key" } },
      ];
      const result = otelAttributesToRecord(attributes);
      expect(result).toEqual({});
    });

    it("skips attributes with invalid values", () => {
      const attributes: DeepPartial<IKeyValue[]> = [
        { key: "invalid", value: { invalidValue: "bad" } as any },
      ];
      const result = otelAttributesToRecord(attributes);
      expect(result).toEqual({});
    });

    it("combines multiple valid attributes", () => {
      const attributes: DeepPartial<IKeyValue[]> = [
        { key: "name", value: { stringValue: "test" } },
        { key: "count", value: { intValue: 42 } },
        { key: "invalid", value: { invalidValue: "bad" } as any },
        {
          key: "tags",
          value: {
            arrayValue: {
              values: [{ stringValue: "tag1" }],
            },
          },
        },
      ];
      const result = otelAttributesToRecord(attributes);
      expect(result).toEqual({
        name: "test",
        count: 42,
        tags: ["tag1"],
      });
    });
  });
});
