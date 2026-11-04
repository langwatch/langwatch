/**
 * Every scope, service, event and metric name here is one grok 1.0.70 sent on the wire.
 * @see specs/coding-agent/grok-sessions.feature
 * @see specs/coding-agent/grok-model-calls.feature
 * @see specs/ai-governance/ingestion-sources/grok-cli-otlp.feature
 */
import { describe, expect, it } from "vitest";

import { buildCodingAgentTranscript } from "../../coding-agent-transcript.ts";
import {
  deriveSessionTitleFromPrompt,
  detectCodingAgent,
  normalizeEventName,
  normalizeMetricName,
  normalizeTokenType,
} from "../coding-agent-normalization.ts";
import { grokAgent } from "../grok.ts";
import {
  CODING_AGENT_REGISTRY,
  LOG_COST_USD_MICROS_ATTRIBUTE_BY_AGENT_ID,
  LOG_INPUT_INCLUDES_CACHE_READ_AGENT_IDS,
  LOGS_ONLY_AGENT_IDS,
  LOGS_REQUIRE_SESSION_KEY_AGENT_IDS,
} from "../index.ts";

describe("the Grok coding-agent definition", () => {
  it("is registered, exactly once", () => {
    expect(CODING_AGENT_REGISTRY.filter((agent) => agent.id === "grok")).toHaveLength(1);
  });

  it("is logs-only, needs a session key, and declares its input and cost quirks", () => {
    expect(LOGS_ONLY_AGENT_IDS.has("grok")).toBe(true);
    expect(LOGS_REQUIRE_SESSION_KEY_AGENT_IDS.has("grok")).toBe(true);
    expect(LOG_INPUT_INCLUDES_CACHE_READ_AGENT_IDS.has("grok")).toBe(true);
    expect(LOG_COST_USD_MICROS_ATTRIBUTE_BY_AGENT_ID.get("grok")).toBe("cost_usd_micros");
  });

  describe("when a signal is detected", () => {
    /** @scenario A record whose service is grok-cli is recognised as Grok */
    it("names Grok from its service and scope", () => {
      expect(detectCodingAgent({ serviceName: "grok-cli", scopeName: "ai.xai.grok_code" })).toBe(
        "grok",
      );
      expect(detectCodingAgent({ scopeName: "ai.xai.grok_code" })).toBe("grok");
      expect(detectCodingAgent({ serviceName: "grok-cli" })).toBe("grok");
    });

    /** @scenario A record carrying only Grok's event prefix is still recognised */
    it("names Grok from its event prefix when service and scope are empty", () => {
      expect(
        detectCodingAgent({ serviceName: "", scopeName: "", recordName: "grok_code.api_request" }),
      ).toBe("grok");
      expect(detectCodingAgent({ recordName: "grok_code.token.usage" })).toBe("grok");
    });

    it("never names Grok from a model name", () => {
      expect(detectCodingAgent({ recordName: "grok-4.7" })).toBe("unknown");
      expect(detectCodingAgent({ serviceName: "my-grok-proxy" })).toBe("unknown");
    });

    /** @scenario A Claude Code record that called a Grok model stays Claude Code's */
    it("leaves Claude Code's records to Claude Code, whatever model they called", () => {
      expect(
        detectCodingAgent({
          scopeName: "com.anthropic.claude_code.events",
          recordName: "claude_code.api_request",
        }),
      ).toBe("claude_code");
    });
  });

  describe("when Grok's names are normalised", () => {
    it("maps Grok's turn events onto the shared vocabulary", () => {
      expect(normalizeEventName("grok_code.user_prompt")).toBe("user_prompt");
      expect(normalizeEventName("grok_code.api_request")).toBe("api_request");
      expect(normalizeEventName("grok_code.tool_result")).toBe("tool_result");
      expect(normalizeEventName("grok_code.tool_decision")).toBe("tool_decision");
      expect(normalizeEventName("grok_code.assistant_response")).toBe("assistant_response");
      expect(normalizeEventName("grok_code.mcp_server_connection")).toBe("mcp_server_connection");
    });

    it("maps Grok's lifecycle events onto nothing", () => {
      for (const name of ["session_start", "session_end", "turn_completed", "subagent"]) {
        expect(normalizeEventName(`grok_code.${name}`)).toBeNull();
      }
      expect(normalizeEventName("grok_code.model_switched")).toBeNull();
    });

    it("maps Grok's token and cost metrics", () => {
      expect(normalizeMetricName("grok_code.token.usage")).toBe("token_usage");
      expect(normalizeMetricName("grok_code.cost.usage")).toBe("cost_usage");
    });

    /** @scenario Grok's token metric types map onto the canonical buckets */
    it("maps Grok's token metric types onto the canonical buckets", () => {
      expect(normalizeTokenType("input")).toBe("input");
      expect(normalizeTokenType("output")).toBe("output");
      expect(normalizeTokenType("reasoning")).toBe("reasoning");
      expect(normalizeTokenType("cache_read")).toBe("cache_read");
    });
  });

  it("strips only its own prefix", () => {
    expect(grokAgent.namePrefixes).toEqual(["grok_code."]);
  });
});

describe("deriveSessionTitleFromPrompt, given Grok's query wrapper", () => {
  it("titles from inside a wrapped top-level prompt", () => {
    expect(
      deriveSessionTitleFromPrompt("<user_query>\nAdd a subtract function.\n</user_query>"),
    ).toBe("Add a subtract function.");
  });

  it("titles a subagent's bare prompt as it is", () => {
    expect(deriveSessionTitleFromPrompt("List the files in src.")).toBe("List the files in src.");
  });

  it("names nothing from an empty wrapper", () => {
    expect(deriveSessionTitleFromPrompt("<user_query>\n</user_query>")).toBeNull();
  });

  it("still names nothing from another machine-injected turn", () => {
    expect(deriveSessionTitleFromPrompt("<task-notification>done</task-notification>")).toBeNull();
  });
});

describe("a Grok trace's transcript", () => {
  const grokLog = (attributes: Record<string, string>, timestampMs = 1_000) => ({
    timestampMs,
    attributes,
    serviceName: "grok-cli",
  });

  /** @scenario A Grok turn's transcript lists each tool run with its input and output */
  it("lists the tool run with its input, output and outcome, and the unwrapped prompt", () => {
    const transcript = buildCodingAgentTranscript({
      spans: [],
      logs: [
        grokLog({
          "event.name": "grok_code.user_prompt",
          prompt: "<user_query>\nCount the lines.\n</user_query>",
        }),
        grokLog(
          {
            "event.name": "grok_code.tool_result",
            tool_name: "read_file",
            tool_input: '{"target_file":"calc.py"}',
            tool_output: "def add(a, b):",
            success: "True",
            duration_ms: "14",
          },
          2_000,
        ),
      ],
    });

    expect(transcript.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "user_prompt", text: "Count the lines." }),
        expect.objectContaining({
          kind: "tool",
          name: "read_file",
          input: { target_file: "calc.py" },
          output: "def add(a, b):",
          failed: false,
          mcpServer: null,
        }),
      ]),
    );
  });

  /** @scenario An allowed Grok tool call is not shown as rejected */
  it("shows a denied decision as rejected and an allowed one not at all", () => {
    const transcript = buildCodingAgentTranscript({
      spans: [],
      logs: [
        grokLog({
          "event.name": "grok_code.tool_decision",
          tool_name: "read_file",
          decision: "allow",
          source: "config",
        }),
        grokLog({
          "event.name": "grok_code.tool_decision",
          tool_name: "run_terminal_command",
          decision: "deny",
          source: "user",
        }),
        grokLog({
          "event.name": "grok_code.tool_decision",
          tool_name: "edit_file",
          decision: "cancelled",
          source: "user",
        }),
      ],
    });

    expect(transcript.entries).toEqual([
      expect.objectContaining({
        kind: "tool_rejected",
        name: "run_terminal_command",
        outcome: "denied",
      }),
      expect.objectContaining({ kind: "tool_rejected", name: "edit_file", outcome: "aborted" }),
    ]);
  });

  /** @scenario A Grok MCP tool run in the transcript names its server */
  it("names the MCP server Grok reported", () => {
    const transcript = buildCodingAgentTranscript({
      spans: [],
      logs: [
        grokLog({
          "event.name": "grok_code.tool_result",
          tool_name: "github__search_repositories",
          mcp_server_name: "github",
          success: "False",
        }),
      ],
    });

    expect(transcript.entries).toEqual([
      expect.objectContaining({ kind: "tool", mcpServer: "github", failed: true }),
    ]);
  });
});
