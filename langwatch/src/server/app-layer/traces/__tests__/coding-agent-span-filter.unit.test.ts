import { describe, expect, it } from "vitest";
import { shouldFilterCodingAgentSpan } from "../coding-agent-span-filter";

describe("shouldFilterCodingAgentSpan", () => {
  describe("given a codex_cli_rs span", () => {
    /** @scenario "The codex turn span survives the noise filter" */
    it("keeps the session_task.turn rollup span", () => {
      expect(
        shouldFilterCodingAgentSpan({
          scopeName: "codex_cli_rs",
          spanName: "session_task.turn",
          attributeKeys: ["model", "codex.turn.token_usage.input_tokens"],
        }),
      ).toBe(false);
    });

    it("keeps a model-call span carrying gen_ai usage", () => {
      expect(
        shouldFilterCodingAgentSpan({
          scopeName: "codex_cli_rs",
          spanName: "handle_responses",
          attributeKeys: ["gen_ai.usage.input_tokens"],
        }),
      ).toBe(false);
    });

    /** @scenario "Codex infrastructure spans are filtered out at ingestion" */
    it("drops infra spans (session init, app server, websocket, plugins)", () => {
      for (const name of [
        "session_init.state_db",
        "app_server.thread_start.upsert_thread",
        "model_client.websocket_connection",
        "plugin/list",
        "receiving",
        "get_model_info",
      ]) {
        expect(
          shouldFilterCodingAgentSpan({
            scopeName: "codex_cli_rs",
            spanName: name,
            attributeKeys: ["code.module.name", "thread.id", "busy_ns"],
          }),
        ).toBe(true);
      }
    });
  });

  describe("given an opencode span", () => {
    /** @scenario "Opencode AI SDK spans survive the noise filter" */
    it("keeps the ai.* Vercel AI SDK operation spans", () => {
      for (const name of [
        "ai.streamText",
        "ai.streamText.doStream",
        "ai.toolCall",
      ]) {
        expect(
          shouldFilterCodingAgentSpan({
            scopeName: "opencode",
            spanName: name,
            attributeKeys: ["ai.model.id"],
          }),
        ).toBe(false);
      }
    });

    /** @scenario "Opencode infrastructure spans are filtered out at ingestion" */
    it("drops infra spans (sql, config, filesystem, auth, session)", () => {
      for (const name of [
        "sql.execute",
        "Config.get",
        "FileSystem.readJson",
        "Auth.all",
        "Session.get",
        "LLM.run",
      ]) {
        expect(
          shouldFilterCodingAgentSpan({
            scopeName: "opencode",
            spanName: name,
            attributeKeys: ["sql", "service.name"],
          }),
        ).toBe(true);
      }
    });
  });

  describe("given a span from any other instrumentation scope", () => {
    /** @scenario "Spans from other instrumentation scopes are never filtered" */
    it("never filters customer / third-party OTLP, even noisy infra names", () => {
      for (const scopeName of [
        "ai",
        "openinference",
        "@traceloop/instrumentation",
        "my-customer-app",
        null,
        undefined,
      ]) {
        expect(
          shouldFilterCodingAgentSpan({
            scopeName,
            spanName: "sql.execute",
            attributeKeys: ["db.statement"],
          }),
        ).toBe(false);
      }
    });
  });
});
