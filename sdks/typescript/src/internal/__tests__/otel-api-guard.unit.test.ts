/**
 * specs/typescript-sdk/observability-otel-3-provider.feature
 */
import * as otelApi from "@opentelemetry/api";
import { describe, expect, it } from "vitest";

import { assertSupportedOtelApi, SUPPORTED_OTEL_API_RANGE } from "../otel-api-guard";

describe("assertSupportedOtelApi()", () => {
  describe("when the installed @opentelemetry/api is 1.10", () => {
    it("accepts it", () => {
      expect(() => assertSupportedOtelApi({ otelApi })).not.toThrow();
    });
  });

  describe("when the installed @opentelemetry/api predates 1.10", () => {
    /** @scenario "An OpenTelemetry API older than 1.10 is refused with a message saying what to install" */
    it("refuses it, naming the range to install and the langwatch 2.x way out", () => {
      const { logs: _logs, SeverityNumber: _severity, ...api19 } = otelApi;

      expect(() => assertSupportedOtelApi({ otelApi: api19 })).toThrow(SUPPORTED_OTEL_API_RANGE);
      expect(() => assertSupportedOtelApi({ otelApi: api19 })).toThrow(/langwatch 2\.x/);
    });
  });
});
