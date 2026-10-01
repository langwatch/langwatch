// @vitest-environment node
import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { observabilityOwner } from "../observability-owner.ts";
import { telemetryExporterOf } from "../process-server.ts";

const exporterOf = (environment: Record<string, string | undefined>, rawHeaders?: string) =>
  telemetryExporterOf({
    observability: parseProcessConfig({ owners: [observabilityOwner], environment }).observability,
    rawHeaders,
  });

describe("the telemetry exporter member", () => {
  it("hands down the OTLP endpoint observability owns", () => {
    expect(exporterOf({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector.test:4318" }).endpoint).toBe(
      "http://collector.test:4318",
    );
    expect(exporterOf({}).endpoint).toBeUndefined();
  });

  it("applies the collector headers inside a build rather than handing them out", () => {
    const exporter = exporterOf({}, "Authorization=Bearer abc,x-scope=team");

    expect(exporter.withHeaders((headers) => headers)).toEqual({
      Authorization: "Bearer abc",
      "x-scope": "team",
    });
  });
});
