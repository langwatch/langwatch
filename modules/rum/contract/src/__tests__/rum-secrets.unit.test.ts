import { telemetryExporterHeaders } from "@langwatch/secrets/shared-secrets";
import { describe, expect, it } from "vitest";

import { rumSecrets } from "../rum.config.ts";

describe("rum's declared secrets", () => {
  it("holds the shared exporter-headers handle, so the exporter's own claim does not collide", () => {
    expect(rumSecrets.telemetryHeaders).toBe(telemetryExporterHeaders);
    expect(telemetryExporterHeaders.id).toBe("OTEL_EXPORTER_OTLP_HEADERS");
  });
});
