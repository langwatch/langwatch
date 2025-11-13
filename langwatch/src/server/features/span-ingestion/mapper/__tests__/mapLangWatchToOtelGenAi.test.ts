import { describe, it, expect } from "vitest";
import { SpanStatusCode } from "@opentelemetry/api";
import type { DeepPartial } from "../../../../../utils/types";
import { type IResource, type IAnyValue, type IStatus } from "@opentelemetry/otlp-transformer";

type TestAnyValue = IAnyValue & Record<string, unknown>;
import type { ErrorCapture } from "../../../../tracer/types";
import {
  determineSpanStatus,
  buildResourceAttributes,
} from "../mapLangWatchToOtelGenAi";

describe("determineSpanStatus", () => {
  describe("when LangWatch span has error", () => {
    it("returns ERROR status with message", () => {
      const langWatchError = {
        has_error: true,
        message: "Test error message",
        stacktrace: ["at line 1", "at line 2"],
      } satisfies ErrorCapture;
      const originalOtelStatus = { code: 1, message: "OK status" };

      const result = determineSpanStatus(langWatchError, originalOtelStatus);

      expect(result.code).toBe(SpanStatusCode.ERROR);
      expect(result.message).toBe("Test error message");
    });

    it("returns ERROR status with undefined message when error message is undefined", () => {
      const langWatchError = {
        has_error: true,
        message: "",
        stacktrace: [],
      } satisfies ErrorCapture;
      const originalOtelStatus = void 0;

      const result = determineSpanStatus(langWatchError, originalOtelStatus);

      expect(result.code).toBe(SpanStatusCode.ERROR);
      expect(result.message).toBe("");
    });
  });

  describe("when LangWatch span has no error", () => {
    describe("when original OTEL status code is number 2 (ERROR)", () => {
      it("returns ERROR status with original message", () => {
        const langWatchError = null;
        const originalOtelStatus = { code: 2, message: "Original error" };

        const result = determineSpanStatus(langWatchError, originalOtelStatus);

        expect(result.code).toBe(SpanStatusCode.ERROR);
        expect(result.message).toBe("Original error");
      });
    });

    describe("when original OTEL status code is string containing ERROR", () => {
      it("returns ERROR status", () => {
        const langWatchError = null;
        const originalOtelStatus = {
          code: 2,
          message: "String error",
        } satisfies DeepPartial<IStatus>;

        const result = determineSpanStatus(langWatchError, originalOtelStatus);

        expect(result.code).toBe(SpanStatusCode.ERROR);
        expect(result.message).toBe("String error");
      });
    });

    describe("when original OTEL status code is number 1 (OK)", () => {
      it("returns OK status", () => {
        const langWatchError = null;
        const originalOtelStatus = { code: 1 };

        const result = determineSpanStatus(langWatchError, originalOtelStatus);

        expect(result.code).toBe(SpanStatusCode.OK);
        expect(result.message).toBeUndefined();
      });
    });

    describe("when original OTEL status code is string containing OK", () => {
      it("returns OK status", () => {
        const langWatchError = null;
        const originalOtelStatus = { code: 1 };

        const result = determineSpanStatus(langWatchError, originalOtelStatus);

        expect(result.code).toBe(SpanStatusCode.OK);
        expect(result.message).toBeUndefined();
      });
    });

    describe("when original OTEL status code is unrecognized", () => {
      it("returns OK status", () => {
        const langWatchError = null;
        const originalOtelStatus = { code: 999 };

        const result = determineSpanStatus(langWatchError, originalOtelStatus);

        expect(result.code).toBe(SpanStatusCode.OK);
        expect(result.message).toBeUndefined();
      });
    });

    describe("when original OTEL status is undefined", () => {
      it("returns OK status", () => {
        const langWatchError = null;
        const originalOtelStatus = undefined;

        const result = determineSpanStatus(langWatchError, originalOtelStatus);

        expect(result.code).toBe(SpanStatusCode.OK);
        expect(result.message).toBeUndefined();
      });
    });
  });
});

describe("buildResourceAttributes", () => {
  describe("when original resource is undefined", () => {
    it("returns empty attributes object", () => {
      const result = buildResourceAttributes(undefined);

      expect(result).toEqual({});
    });
  });

  describe("when original resource has no attributes", () => {
    it("returns empty attributes object", () => {
      const originalResource: DeepPartial<IResource> = {};

      const result = buildResourceAttributes(originalResource);

      expect(result).toEqual({});
    });
  });

  describe("when original resource has attributes", () => {
    describe("when attribute has string value", () => {
      it("includes string attribute", () => {
        const originalResource: DeepPartial<IResource> = {
          attributes: [
            {
              key: "service.name",
              value: { stringValue: "test-service" },
            },
          ],
        };

        const result = buildResourceAttributes(originalResource);

        expect(result).toEqual({
          "service.name": "test-service",
        });
      });
    });

    describe("when attribute has number value", () => {
      it("includes number attribute", () => {
        const originalResource: DeepPartial<IResource> = {
          attributes: [
            {
              key: "service.version",
              value: { doubleValue: 1.0 },
            },
          ],
        };

        const result = buildResourceAttributes(originalResource);

        expect(result).toEqual({
          "service.version": 1.0,
        });
      });
    });

    describe("when attribute has boolean value", () => {
      it("includes boolean attribute", () => {
        const originalResource: DeepPartial<IResource> = {
          attributes: [
            {
              key: "service.enabled",
              value: { boolValue: true },
            },
          ],
        };

        const result = buildResourceAttributes(originalResource);

        expect(result).toEqual({
          "service.enabled": true,
        });
      });
    });

    describe("when attribute has array value with valid primitives", () => {
      it("includes array attribute", () => {
        const originalResource: DeepPartial<IResource> = {
          attributes: [
            {
              key: "tags",
              value: {
                arrayValue: {
                  values: [
                    { stringValue: "tag1" },
                    { stringValue: "tag2" },
                  ],
                },
              },
            },
          ],
        };

        const result = buildResourceAttributes(originalResource);

        expect(result).toEqual({
          tags: ["tag1", "tag2"],
        });
      });
    });

    describe("when attribute has array value with mixed valid types", () => {
      it("includes array attribute", () => {
        const originalResource: DeepPartial<IResource> = {
          attributes: [
            {
              key: "mixed",
              value: {
                arrayValue: {
                  values: [
                    { stringValue: "text" },
                    { intValue: 42 },
                    { boolValue: true },
                  ],
                },
              },
            },
          ],
        };

        const result = buildResourceAttributes(originalResource);

        expect(result).toEqual({
          mixed: ["text", 42, true],
        });
      });
    });

    describe("when attribute has array value with null and undefined", () => {
      it("includes array attribute", () => {
        const originalResource: DeepPartial<IResource> = {
          attributes: [
            {
              key: "nullable",
              value: {
                arrayValue: {
                  values: [
                    { stringValue: "text" },
                  ],
                },
              },
            },
          ],
        };

        const result = buildResourceAttributes(originalResource);

        expect(result).toEqual({
          nullable: ["text"],
        });
      });
    });

    describe("when attribute has kvlist value", () => {
      it("excludes kvlist attribute", () => {
        const originalResource: DeepPartial<IResource> = {
          attributes: [
            {
              key: "kvlist_attr",
              value: {
                kvlistValue: {
                  values: [{ key: "nested", value: { stringValue: "value" } }],
                },
              },
            },
          ],
        };

        const result = buildResourceAttributes(originalResource);

        expect(result).toEqual({});
      });
    });

    describe("when attribute has no key", () => {
      it("skips attribute", () => {
        const originalResource: DeepPartial<IResource> = {
          attributes: [
            {
              value: { stringValue: "no-key" },
            },
          ],
        };

        const result = buildResourceAttributes(originalResource);

        expect(result).toEqual({});
      });
    });

    describe("when attribute value is invalid", () => {
      it("skips attribute", () => {
        const originalResource: DeepPartial<IResource> = {
          attributes: [
            {
              key: "invalid",
              value: { invalidValue: "bad" } as TestAnyValue,
            },
          ],
        };

        const result = buildResourceAttributes(originalResource);

        expect(result).toEqual({});
      });
    });

    describe("when multiple valid attributes exist", () => {
      it("includes all valid attributes", () => {
        const originalResource: DeepPartial<IResource> = {
          attributes: [
            {
              key: "service.name",
              value: { stringValue: "test-service" },
            },
            {
              key: "service.version",
              value: { doubleValue: 2 },
            },
            {
              key: "invalid",
              value: { invalidValue: "bad" } as TestAnyValue,
            },
            {
              key: "tags",
              value: {
                arrayValue: {
                  values: [
                    { stringValue: "tag1" },
                    { stringValue: "tag2" },
                  ],
                },
              },
            },
          ],
        };

        const result = buildResourceAttributes(originalResource);

        expect(result).toEqual({
          "service.name": "test-service",
          "service.version": 2.0,
          tags: ["tag1", "tag2"],
        });
      });
    });
  });
});
