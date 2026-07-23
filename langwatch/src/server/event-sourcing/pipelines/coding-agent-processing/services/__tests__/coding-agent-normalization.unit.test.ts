/**
 * One vocabulary for every coding agent.
 *
 * Every string in this file is a REAL wire value — taken from each agent's source
 * or from our own live telemetry. Inventing plausible-looking identifiers here
 * would defeat the entire purpose of the module, which exists precisely because
 * the agents do not spell things the way you would guess.
 */
import { describe, expect, it } from "vitest";
import {
  detectCodingAgent,
  isCodingAgentMetricName,
  normalizeEventName,
  normalizeMetricName,
  normalizeTokenType,
  parseMcpToolName,
  resolveConversationKey,
  resolveToolName,
} from "../coding-agent-normalization";

describe("detectCodingAgent", () => {
  describe("given the name of the record", () => {
    it("names each agent from its own namespace", () => {
      expect(detectCodingAgent({ recordName: "claude_code.tool" })).toBe(
        "claude_code",
      );
      expect(detectCodingAgent({ recordName: "opencode.token.usage" })).toBe(
        "opencode",
      );
      expect(detectCodingAgent({ recordName: "codex.tool.call" })).toBe(
        "codex",
      );
    });
  });

  describe("given only an instrumentation scope", () => {
    it("falls back to it", () => {
      expect(
        detectCodingAgent({ scopeName: "com.anthropic.claude_code.events" }),
      ).toBe("claude_code");
      expect(detectCodingAgent({ scopeName: "com.opencode" })).toBe("opencode");
    });
  });

  describe("given a Codex record", () => {
    /**
     * Codex's instrumentation scope is whatever `service_name` it was configured
     * with — there is no stable `com.openai.codex` string to match. So the scope
     * cannot be the primary signal for anyone, and the record NAME has to be.
     */
    it("is recognised by its record name, not its scope", () => {
      expect(
        detectCodingAgent({
          scopeName: "some-service-name-the-user-picked",
          recordName: "codex.turn.token_usage",
        }),
      ).toBe("codex");
    });
  });

  describe("given something that is not a coding agent", () => {
    it("says so, rather than guessing", () => {
      expect(detectCodingAgent({ recordName: "openai.chat" })).toBe("unknown");
      expect(detectCodingAgent({})).toBe("unknown");
    });
  });
});

describe("resolveConversationKey", () => {
  /**
   * The one key every agent agrees on — under four different names. Claude Code
   * puts `session.id` on its LOGS but `gen_ai.conversation.id` on its SPANS, and
   * they carry the identical UUID (verified against live data). If this function
   * only knew one of them, a session's spans and logs would never join.
   */
  it("finds the session however the agent spelled it", () => {
    expect(resolveConversationKey({ "session.id": "s-1" })).toBe("s-1");
    expect(resolveConversationKey({ "gen_ai.conversation.id": "s-1" })).toBe(
      "s-1",
    );
    expect(resolveConversationKey({ "conversation.id": "s-1" })).toBe("s-1");
    expect(resolveConversationKey({ "thread.id": "s-1" })).toBe("s-1");
  });

  it("returns null rather than an empty string when there is no session", () => {
    expect(resolveConversationKey({})).toBeNull();
    expect(resolveConversationKey({ "session.id": "" })).toBeNull();
  });
});

describe("normalizeEventName", () => {
  describe("given the same event from three agents", () => {
    // Two namespace it, one does not. That inconsistency is the whole reason
    // the prefix is stripped rather than enumerated.
    it("lands them all on one fact", () => {
      expect(normalizeEventName("claude_code.tool_result")).toBe("tool_result");
      expect(normalizeEventName("codex.tool_result")).toBe("tool_result");
      expect(normalizeEventName("tool_result")).toBe("tool_result");
    });
  });

  describe("given opencode's dotted session events", () => {
    it("reads them as the same facts", () => {
      expect(normalizeEventName("session.created")).toBe("session_created");
      expect(normalizeEventName("session.idle")).toBe("session_idle");
      expect(normalizeEventName("session.error")).toBe("session_error");
    });
  });

  describe("given an event we have no use for", () => {
    it("returns null instead of inventing a fact", () => {
      expect(normalizeEventName("codex.websocket_connect")).toBeNull();
      expect(normalizeEventName("")).toBeNull();
      expect(normalizeEventName(null)).toBeNull();
    });
  });
});

describe("normalizeTokenType", () => {
  describe("given the cache buckets, which every agent spells differently", () => {
    /**
     * The distinction that costs money: a cache READ bills at a fraction of fresh
     * input, while a cache WRITE costs MORE than it. Mapping one onto the other
     * does not throw — it silently misprices the session.
     */
    it("tells a cache read apart from a cache write, in every dialect", () => {
      // Claude Code / opencode
      expect(normalizeTokenType("cacheRead")).toBe("cache_read");
      expect(normalizeTokenType("cacheCreation")).toBe("cache_creation");
      // Codex
      expect(normalizeTokenType("cached_input")).toBe("cache_read");
      // snake_case spellings of the same things
      expect(normalizeTokenType("cache_read")).toBe("cache_read");
      expect(normalizeTokenType("cache_creation")).toBe("cache_creation");
    });
  });

  describe("given reasoning tokens", () => {
    it("accepts both spellings", () => {
      expect(normalizeTokenType("reasoning")).toBe("reasoning");
      expect(normalizeTokenType("reasoning_output")).toBe("reasoning");
    });
  });

  describe("given Codex's `total` bucket", () => {
    // Codex reports `total` ALONGSIDE the parts. Counting it as a bucket would
    // double every token in the session.
    it("refuses it, so tokens are not double-counted", () => {
      expect(normalizeTokenType("total")).toBeNull();
    });
  });

  it("maps the plain buckets", () => {
    expect(normalizeTokenType("input")).toBe("input");
    expect(normalizeTokenType("output")).toBe("output");
    expect(normalizeTokenType("non_cached_input")).toBe("input");
  });
});

describe("resolveToolName", () => {
  describe("given Claude Code / Codex, which carry the tool in an attribute", () => {
    it("reads the attribute", () => {
      expect(
        resolveToolName({
          spanName: "claude_code.tool",
          attrs: { tool_name: "Bash" },
        }),
      ).toBe("Bash");
      expect(
        resolveToolName({
          spanName: "mcp.tools.call",
          attrs: { "tool.name": "search" },
        }),
      ).toBe("search");
    });
  });

  describe("given opencode, which puts the tool IN the span name", () => {
    // Reading only the attribute loses every opencode tool.
    it("reads it out of the span name", () => {
      expect(
        resolveToolName({ spanName: "opencode.tool.bash", attrs: {} }),
      ).toBe("bash");
    });
  });

  it("returns null when there is no tool to name", () => {
    expect(resolveToolName({ spanName: "opencode.llm", attrs: {} })).toBeNull();
    expect(
      resolveToolName({ spanName: "opencode.tool.", attrs: {} }),
    ).toBeNull();
  });
});

describe("parseMcpToolName", () => {
  it("names the server and the tool from a real MCP tool name", () => {
    expect(parseMcpToolName("mcp__claude-in-chrome__tabs_context_mcp")).toEqual(
      {
        server: "claude-in-chrome",
        tool: "tabs_context_mcp",
      },
    );
  });

  it("keeps the rest of the name when the tool contains the separator", () => {
    expect(parseMcpToolName("mcp__srv__a__b")).toEqual({
      server: "srv",
      tool: "a__b",
    });
  });

  it("refuses names it cannot trust rather than inventing an empty server", () => {
    expect(parseMcpToolName("Bash")).toBeNull();
    expect(parseMcpToolName("mcp__onlyserver")).toBeNull();
    expect(parseMcpToolName("mcp____tool")).toBeNull();
    expect(parseMcpToolName("mcp__srv__")).toBeNull();
    expect(parseMcpToolName(null)).toBeNull();
  });
});

describe("Gemini CLI", () => {
  it("is recognised, and its dialect maps onto the same facts", () => {
    expect(detectCodingAgent({ recordName: "gemini_cli.token.usage" })).toBe(
      "gemini_cli",
    );
    expect(detectCodingAgent({ scopeName: "gemini-cli" })).toBe("gemini_cli");

    // Gemini's tool log carries success + duration — it IS the tool result.
    expect(normalizeEventName("gemini_cli.tool_call")).toBe("tool_result");
    expect(normalizeEventName("gemini_cli.chat_compression")).toBe(
      "compaction",
    );
    expect(normalizeMetricName("gemini_cli.lines.changed")).toBe(
      "lines_of_code",
    );
  });

  describe("given Gemini's token vocabulary", () => {
    it("maps `thought` to reasoning and bare `cache` to a cache read", () => {
      expect(normalizeTokenType("thought")).toBe("reasoning");
      expect(normalizeTokenType("cache")).toBe("cache_read");
    });

    it("refuses `tool` tokens, which are already inside the input count", () => {
      // Counting them again would inflate every Gemini session's input tokens.
      expect(normalizeTokenType("tool")).toBeNull();
    });
  });
});

describe("GitHub Copilot CLI", () => {
  /**
   * Copilot namespaces under the ORG (`github.copilot.`), not the product, so a
   * naive `copilot.` prefix strip misses every one of its identifiers.
   */
  it("is recognised through its org-prefixed namespace", () => {
    expect(detectCodingAgent({ scopeName: "github.copilot" })).toBe("copilot");
    expect(detectCodingAgent({ serviceName: "github-copilot" })).toBe(
      "copilot",
    );
    expect(normalizeMetricName("github.copilot.tool.call.count")).toBe(
      "tool_call",
    );
  });

  it("finds the session on its spans, where the only copy of it lives", () => {
    // Copilot metrics are fleet-level and it emits NO log records at all — its
    // spans are the sole place a session id (or a cost) can be read.
    expect(resolveConversationKey({ "gen_ai.conversation.id": "conv-9" })).toBe(
      "conv-9",
    );
  });
});

describe("isCodingAgentMetricName", () => {
  it("admits every agent, not just the first one we happened to support", () => {
    // Was `startsWith("claude_code.")`, which silently dropped the rest.
    expect(isCodingAgentMetricName("claude_code.token.usage")).toBe(true);
    expect(isCodingAgentMetricName("opencode.token.usage")).toBe(true);
    expect(isCodingAgentMetricName("gemini_cli.lines.changed")).toBe(true);
    expect(isCodingAgentMetricName("codex.turn.token_usage")).toBe(true);
  });

  it("still rejects a metric that has nothing to do with a coding agent", () => {
    expect(isCodingAgentMetricName("http.server.duration")).toBe(false);
    // A coding agent's metric we have no mapping for is also not worth folding.
    expect(isCodingAgentMetricName("codex.websocket.request")).toBe(false);
  });
});
