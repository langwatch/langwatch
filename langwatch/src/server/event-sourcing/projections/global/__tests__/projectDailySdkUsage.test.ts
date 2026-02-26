import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVALUATION_STARTED_EVENT_TYPE } from "../../../pipelines/evaluation-processing/schemas/constants";
import { SPAN_RECEIVED_EVENT_TYPE } from "../../../pipelines/trace-processing/schemas/constants";
import type { Event } from "../../../domain/types";
import {
	createTestEvent,
	createTestTenantId,
	TEST_CONSTANTS,
} from "../../../services/__tests__/testHelpers";
import {
	extractSdkInfoFromEvent,
	projectDailySdkUsageProjection,
} from "../projectDailySdkUsage.foldProjection";

describe("projectDailySdkUsageProjection", () => {
  const tenantId = createTestTenantId();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("definition", () => {
    it("subscribes to span_received events only", () => {
      expect(projectDailySdkUsageProjection.eventTypes).toEqual([
        SPAN_RECEIVED_EVENT_TYPE,
      ]);
    });
  });

  describe("key function", () => {
    it("includes SDK info in key for span events with SDK attributes", () => {
      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        SPAN_RECEIVED_EVENT_TYPE,
        1_700_000_000_000,
        "2025-12-14",
        {
          span: {},
          resource: {
            attributes: [
              {
                key: "langwatch.sdk.name",
                value: { stringValue: "langwatch-observability-sdk" },
              },
              {
                key: "langwatch.sdk.version",
                value: { stringValue: "0.13.0" },
              },
              {
                key: "langwatch.sdk.language",
                value: { stringValue: "python" },
              },
            ],
          },
          instrumentationScope: null,
          piiRedactionLevel: "STRICT",
        },
      );

      const key = projectDailySdkUsageProjection.key!(event as Event);
      expect(key).toBe(
        `2023-11-14:langwatch-observability-sdk:0.13.0:python`,
      );
    });

    it("groups events from the same day and SDK together", () => {
      const dayMs = 1_700_000_000_000;
      const spanData = {
        span: {},
        resource: {
          attributes: [
            {
              key: "langwatch.sdk.name",
              value: { stringValue: "langwatch-observability-sdk" },
            },
            {
              key: "langwatch.sdk.version",
              value: { stringValue: "0.13.0" },
            },
            {
              key: "langwatch.sdk.language",
              value: { stringValue: "python" },
            },
          ],
        },
        instrumentationScope: null,
        piiRedactionLevel: "STRICT",
      };

      const event1 = createTestEvent(
        "agg-1",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        SPAN_RECEIVED_EVENT_TYPE,
        dayMs,
        "2025-12-14",
        spanData,
      );
      const event2 = createTestEvent(
        "agg-2",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        SPAN_RECEIVED_EVENT_TYPE,
        dayMs + 3600_000,
        "2025-12-14",
        spanData,
      );

      const key1 = projectDailySdkUsageProjection.key!(event1 as Event);
      const key2 = projectDailySdkUsageProjection.key!(event2 as Event);
      expect(key1).toBe(key2);
    });
  });

  describe("apply function", () => {
    it("sets SDK info and timestamp from span event", () => {
      const state = projectDailySdkUsageProjection.init();
      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        SPAN_RECEIVED_EVENT_TYPE,
        1_700_000_000_000,
        "2025-12-14",
        {
          span: {},
          resource: {
            attributes: [
              {
                key: "langwatch.sdk.name",
                value: { stringValue: "langwatch-observability-sdk" },
              },
              {
                key: "langwatch.sdk.version",
                value: { stringValue: "0.13.0" },
              },
              {
                key: "langwatch.sdk.language",
                value: { stringValue: "python" },
              },
            ],
          },
          instrumentationScope: null,
          piiRedactionLevel: "STRICT",
        },
      );

      const newState = projectDailySdkUsageProjection.apply(
        state,
        event as Event,
      );

      expect(newState.projectId).toBe(String(tenantId));
      expect(newState.date).toBe("2023-11-14");
      expect(newState.sdkName).toBe("langwatch-observability-sdk");
      expect(newState.sdkVersion).toBe("0.13.0");
      expect(newState.sdkLanguage).toBe("python");
      expect(newState.lastEventTimestamp).toBe(1_700_000_000_000);
    });
  });
});

describe("extractSdkInfoFromEvent", () => {
  const tenantId = createTestTenantId();

  describe("when event is not a span_received event", () => {
    it("returns 'other' bucket", () => {
      const event = createTestEvent(
        "agg-1",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVALUATION_STARTED_EVENT_TYPE,
      );

      const result = extractSdkInfoFromEvent(event as Event);
      expect(result).toEqual({
        sdkName: "other",
        sdkVersion: "",
        sdkLanguage: "",
      });
    });
  });

  describe("when resource is null", () => {
    it("returns 'other' bucket", () => {
      const event = createTestEvent(
        "agg-1",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        SPAN_RECEIVED_EVENT_TYPE,
        1000000,
        "2025-12-14",
        {
          span: {},
          resource: null,
          instrumentationScope: null,
          piiRedactionLevel: "STRICT",
        },
      );

      const result = extractSdkInfoFromEvent(event as Event);
      expect(result).toEqual({
        sdkName: "other",
        sdkVersion: "",
        sdkLanguage: "",
      });
    });
  });

  describe("when SDK attributes are missing", () => {
    it("returns 'other' bucket when name is missing", () => {
      const event = createTestEvent(
        "agg-1",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        SPAN_RECEIVED_EVENT_TYPE,
        1000000,
        "2025-12-14",
        {
          span: {},
          resource: {
            attributes: [
              {
                key: "langwatch.sdk.version",
                value: { stringValue: "0.13.0" },
              },
              {
                key: "langwatch.sdk.language",
                value: { stringValue: "python" },
              },
            ],
          },
          instrumentationScope: null,
          piiRedactionLevel: "STRICT",
        },
      );

      const result = extractSdkInfoFromEvent(event as Event);
      expect(result.sdkName).toBe("other");
    });

    it("returns 'other' bucket when version is missing", () => {
      const event = createTestEvent(
        "agg-1",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        SPAN_RECEIVED_EVENT_TYPE,
        1000000,
        "2025-12-14",
        {
          span: {},
          resource: {
            attributes: [
              {
                key: "langwatch.sdk.name",
                value: { stringValue: "langwatch-observability-sdk" },
              },
              {
                key: "langwatch.sdk.language",
                value: { stringValue: "python" },
              },
            ],
          },
          instrumentationScope: null,
          piiRedactionLevel: "STRICT",
        },
      );

      const result = extractSdkInfoFromEvent(event as Event);
      expect(result.sdkName).toBe("other");
    });

    it("returns 'other' bucket when language is missing", () => {
      const event = createTestEvent(
        "agg-1",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        SPAN_RECEIVED_EVENT_TYPE,
        1000000,
        "2025-12-14",
        {
          span: {},
          resource: {
            attributes: [
              {
                key: "langwatch.sdk.name",
                value: { stringValue: "langwatch-observability-sdk" },
              },
              {
                key: "langwatch.sdk.version",
                value: { stringValue: "0.13.0" },
              },
            ],
          },
          instrumentationScope: null,
          piiRedactionLevel: "STRICT",
        },
      );

      const result = extractSdkInfoFromEvent(event as Event);
      expect(result.sdkName).toBe("other");
    });
  });

  describe("when all SDK attributes are present", () => {
    it("extracts Python SDK info", () => {
      const event = createTestEvent(
        "agg-1",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        SPAN_RECEIVED_EVENT_TYPE,
        1000000,
        "2025-12-14",
        {
          span: {},
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "my-service" } },
              {
                key: "langwatch.sdk.name",
                value: { stringValue: "langwatch-observability-sdk" },
              },
              {
                key: "langwatch.sdk.version",
                value: { stringValue: "0.13.0" },
              },
              {
                key: "langwatch.sdk.language",
                value: { stringValue: "python" },
              },
            ],
          },
          instrumentationScope: null,
          piiRedactionLevel: "STRICT",
        },
      );

      const result = extractSdkInfoFromEvent(event as Event);
      expect(result).toEqual({
        sdkName: "langwatch-observability-sdk",
        sdkVersion: "0.13.0",
        sdkLanguage: "python",
      });
    });

    it("extracts TypeScript SDK info", () => {
      const event = createTestEvent(
        "agg-1",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        SPAN_RECEIVED_EVENT_TYPE,
        1000000,
        "2025-12-14",
        {
          span: {},
          resource: {
            attributes: [
              {
                key: "langwatch.sdk.name",
                value: { stringValue: "langwatch-observability-sdk" },
              },
              {
                key: "langwatch.sdk.version",
                value: { stringValue: "0.16.1" },
              },
              {
                key: "langwatch.sdk.language",
                value: { stringValue: "typescript" },
              },
            ],
          },
          instrumentationScope: null,
          piiRedactionLevel: "STRICT",
        },
      );

      const result = extractSdkInfoFromEvent(event as Event);
      expect(result).toEqual({
        sdkName: "langwatch-observability-sdk",
        sdkVersion: "0.16.1",
        sdkLanguage: "typescript",
      });
    });
  });

  describe("when resource has empty attributes array", () => {
    it("returns 'other' bucket", () => {
      const event = createTestEvent(
        "agg-1",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        SPAN_RECEIVED_EVENT_TYPE,
        1000000,
        "2025-12-14",
        {
          span: {},
          resource: { attributes: [] },
          instrumentationScope: null,
          piiRedactionLevel: "STRICT",
        },
      );

      const result = extractSdkInfoFromEvent(event as Event);
      expect(result).toEqual({
        sdkName: "other",
        sdkVersion: "",
        sdkLanguage: "",
      });
    });
  });

  describe("when stringValue is null", () => {
    it("returns 'other' bucket", () => {
      const event = createTestEvent(
        "agg-1",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        SPAN_RECEIVED_EVENT_TYPE,
        1000000,
        "2025-12-14",
        {
          span: {},
          resource: {
            attributes: [
              {
                key: "langwatch.sdk.name",
                value: { stringValue: null },
              },
              {
                key: "langwatch.sdk.version",
                value: { stringValue: "0.13.0" },
              },
              {
                key: "langwatch.sdk.language",
                value: { stringValue: "python" },
              },
            ],
          },
          instrumentationScope: null,
          piiRedactionLevel: "STRICT",
        },
      );

      const result = extractSdkInfoFromEvent(event as Event);
      expect(result.sdkName).toBe("other");
    });
  });

  describe("when using telemetry.sdk.* fallback", () => {
    it("extracts SDK info from telemetry.sdk.* when name contains 'langwatch'", () => {
      const event = createTestEvent(
        "agg-1",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        SPAN_RECEIVED_EVENT_TYPE,
        1000000,
        "2025-12-14",
        {
          span: {},
          resource: {
            attributes: [
              {
                key: "telemetry.sdk.name",
                value: { stringValue: "langwatch-observability-sdk" },
              },
              {
                key: "telemetry.sdk.version",
                value: { stringValue: "0.15.0" },
              },
              {
                key: "telemetry.sdk.language",
                value: { stringValue: "typescript" },
              },
            ],
          },
          instrumentationScope: null,
          piiRedactionLevel: "STRICT",
        },
      );

      const result = extractSdkInfoFromEvent(event as Event);
      expect(result).toEqual({
        sdkName: "langwatch-observability-sdk",
        sdkVersion: "0.15.0",
        sdkLanguage: "typescript",
      });
    });

    it("ignores telemetry.sdk.* when name does not contain 'langwatch'", () => {
      const event = createTestEvent(
        "agg-1",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        SPAN_RECEIVED_EVENT_TYPE,
        1000000,
        "2025-12-14",
        {
          span: {},
          resource: {
            attributes: [
              {
                key: "telemetry.sdk.name",
                value: { stringValue: "opentelemetry" },
              },
              {
                key: "telemetry.sdk.version",
                value: { stringValue: "1.0.0" },
              },
              {
                key: "telemetry.sdk.language",
                value: { stringValue: "nodejs" },
              },
            ],
          },
          instrumentationScope: null,
          piiRedactionLevel: "STRICT",
        },
      );

      const result = extractSdkInfoFromEvent(event as Event);
      expect(result).toEqual({
        sdkName: "other",
        sdkVersion: "",
        sdkLanguage: "",
      });
    });

    it("prefers langwatch.sdk.* over telemetry.sdk.* when both present", () => {
      const event = createTestEvent(
        "agg-1",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        SPAN_RECEIVED_EVENT_TYPE,
        1000000,
        "2025-12-14",
        {
          span: {},
          resource: {
            attributes: [
              {
                key: "telemetry.sdk.name",
                value: { stringValue: "langwatch-observability-sdk" },
              },
              {
                key: "telemetry.sdk.version",
                value: { stringValue: "0.15.0" },
              },
              {
                key: "telemetry.sdk.language",
                value: { stringValue: "typescript" },
              },
              {
                key: "langwatch.sdk.name",
                value: { stringValue: "langwatch-observability-sdk" },
              },
              {
                key: "langwatch.sdk.version",
                value: { stringValue: "0.16.1" },
              },
              {
                key: "langwatch.sdk.language",
                value: { stringValue: "typescript" },
              },
            ],
          },
          instrumentationScope: null,
          piiRedactionLevel: "STRICT",
        },
      );

      const result = extractSdkInfoFromEvent(event as Event);
      expect(result).toEqual({
        sdkName: "langwatch-observability-sdk",
        sdkVersion: "0.16.1",
        sdkLanguage: "typescript",
      });
    });
  });
});
