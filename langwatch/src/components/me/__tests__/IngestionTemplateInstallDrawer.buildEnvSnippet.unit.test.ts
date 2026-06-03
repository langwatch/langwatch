import { describe, expect, it } from "vitest";

import { buildEnvSnippet } from "../IngestionTemplateInstallDrawer";

const ENDPOINT = "https://app.langwatch.ai/api/otel";
const TOKEN = "ik-lw-TEST_TOKEN";

describe("buildEnvSnippet", () => {
  describe("when the template slug is claude_code", () => {
    const snippet = buildEnvSnippet("claude_code", ENDPOINT, TOKEN);

    it("includes the claude-code telemetry switch", () => {
      expect(snippet).toContain("export CLAUDE_CODE_ENABLE_TELEMETRY=1");
    });

    it("recommends OTEL_TRACES_EXPORTER=otlp", () => {
      // Without traces exporter, claude-code never emits spans, every log
      // arrives without trace context, and the fold-skip in
      // traceSummary.foldProjection drops them from /messages.
      expect(snippet).toContain("export OTEL_TRACES_EXPORTER=otlp");
    });

    it("recommends OTEL_LOGS_EXPORTER=otlp", () => {
      expect(snippet).toContain("export OTEL_LOGS_EXPORTER=otlp");
    });

    it("recommends OTEL_METRICS_EXPORTER=otlp", () => {
      expect(snippet).toContain("export OTEL_METRICS_EXPORTER=otlp");
    });

    it("uses http/json protocol", () => {
      expect(snippet).toContain("export OTEL_EXPORTER_OTLP_PROTOCOL=http/json");
    });

    it("interpolates the endpoint and token", () => {
      expect(snippet).toContain(`OTEL_EXPORTER_OTLP_ENDPOINT="${ENDPOINT}"`);
      expect(snippet).toContain(
        `OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer ${TOKEN}"`,
      );
    });
  });

  describe("when the template slug is anything else", () => {
    const snippet = buildEnvSnippet("cursor", ENDPOINT, TOKEN);

    it("emits only the endpoint and bearer header", () => {
      // Non-claude-code sources enable telemetry through their own config.
      expect(snippet).not.toContain("CLAUDE_CODE_ENABLE_TELEMETRY");
      expect(snippet).not.toContain("OTEL_TRACES_EXPORTER");
      expect(snippet).not.toContain("OTEL_LOGS_EXPORTER");
      expect(snippet).toContain(`OTEL_EXPORTER_OTLP_ENDPOINT="${ENDPOINT}"`);
      expect(snippet).toContain(
        `OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer ${TOKEN}"`,
      );
    });
  });
});
