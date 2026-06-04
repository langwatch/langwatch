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

    // claude-code 2.x emits four OTEL_LOG_* unlock knobs. Each is
    // load-bearing for a distinct slice of the trace surface:
    //   USER_PROMPTS       lifts user prompt text onto user_prompt events
    //   TOOL_DETAILS       lifts tool_input/tool_parameters attrs (Bash
    //                      command, Edit diff, file paths) onto
    //                      tool_decision + tool_result events. Without
    //                      it the receiver gets only sizes-in-bytes.
    //   TOOL_CONTENT       traces-only + beta tracing — no-op for claude
    //                      2.x logs path today, set as forward-compat
    //   RAW_API_BODIES     emits api_request_body + api_response_body
    //                      events. THIS is the only OTel surface that
    //                      carries the assistant response text.
    // Dropping any of USER_PROMPTS / TOOL_DETAILS / RAW_API_BODIES
    // silently regresses content visibility in /me/traces. Pin all
    // four here.
    it("sets all 4 claude OTEL_LOG_* unlock knobs (collect-everything)", () => {
      expect(snippet).toContain("export OTEL_LOG_USER_PROMPTS=1");
      expect(snippet).toContain("export OTEL_LOG_TOOL_DETAILS=1");
      expect(snippet).toContain("export OTEL_LOG_TOOL_CONTENT=1");
      expect(snippet).toContain("export OTEL_LOG_RAW_API_BODIES=1");
    });

    it("interpolates the endpoint and token", () => {
      expect(snippet).toContain(`OTEL_EXPORTER_OTLP_ENDPOINT="${ENDPOINT}"`);
      expect(snippet).toContain(
        `OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer ${TOKEN}"`,
      );
    });
  });

  describe("when the template slug is gemini", () => {
    const snippet = buildEnvSnippet("gemini", ENDPOINT, TOKEN);

    // gemini-cli 0.46 emits OTLP traces + log records only when this
    // exact 6-knob combination is set on the env. Each knob is
    // load-bearing — see typescript-sdk wrapper-mode tests for the
    // per-knob why. Dropping ANY of them silently regresses gemini
    // Path B to "metrics only" (the false-vendor-limit we shipped in
    // an earlier matrix iteration). Pin them here so a refactor of
    // this drawer can't quietly undo the fix.
    it("sets all 6 gemini telemetry knobs required for OTLP", () => {
      expect(snippet).toContain("export GEMINI_TELEMETRY_ENABLED=true");
      expect(snippet).toContain("export GEMINI_TELEMETRY_TARGET=local");
      expect(snippet).toContain("export GEMINI_TELEMETRY_USE_COLLECTOR=true");
      expect(snippet).toContain("export GEMINI_TELEMETRY_TRACES_ENABLED=true");
      expect(snippet).toContain("export GEMINI_TELEMETRY_OTLP_PROTOCOL=http");
      expect(snippet).toContain(
        `export GEMINI_TELEMETRY_OTLP_ENDPOINT="${ENDPOINT}"`,
      );
      expect(snippet).toContain("export GEMINI_TELEMETRY_LOG_PROMPTS=true");
    });

    it("rejects target=otlp (runtime-invalid in gemini-cli 0.46)", () => {
      // parseTelemetryTargetValue in gemini-cli only accepts local|gcp.
      // The JSON-schema doc string lists otlp as an example, which is
      // a lie — passing it throws FatalConfigError at startup. Guard
      // against future-me trusting the doc string.
      expect(snippet).not.toContain("GEMINI_TELEMETRY_TARGET=otlp");
    });

    it("interpolates endpoint and token into the OTel base env", () => {
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
