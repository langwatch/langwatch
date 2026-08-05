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
  declaredCodingAgent,
  detectCodingAgent,
  isCodingAgentMetricName,
  liftCodingAgentLogFacts,
  mergeAliasTables,
  normalizeEventName,
  normalizeMetricName,
  normalizeTokenType,
  parseMcpToolName,
  resolveConversationKey,
  resolveToolName,
  SESSION_CONTEXT_EVENT_NAME,
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

  describe("given a Cowork record", () => {
    /**
     * Cowork is the Claude desktop runtime working in a VM: its events reuse
     * Claude Code's vocabulary and scope, and only the resource-level
     * `service.name: cowork` (its docs' Service information table) names it.
     * The service signal must beat the anthropic-scope fallback.
     */
    it("is named by its service, not its runtime's scope", () => {
      expect(
        detectCodingAgent({
          scopeName: "com.anthropic.claude_code.events",
          recordName: "claude_code.user_prompt",
          serviceName: "cowork",
        }),
      ).toBe("claude_cowork");
    });

    it("is recognised from the service alone when events arrive bare", () => {
      expect(
        detectCodingAgent({
          recordName: "user_prompt",
          serviceName: "cowork",
        }),
      ).toBe("claude_cowork");
    });

    it("does not claim Claude Code sessions, which carry no cowork service", () => {
      expect(
        detectCodingAgent({
          scopeName: "com.anthropic.claude_code.events",
          recordName: "claude_code.user_prompt",
          serviceName: "claude-code",
        }),
      ).toBe("claude_code");
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

  describe("given each agent's vendor-specific event spellings", () => {
    /**
     * These aliases live on the agent definitions (agents/*.ts) since the
     * registry refactor; each is a REAL wire value, so a typo'd key or a
     * broken registry merge would silently stop mapping a real event.
     */
    it("still lands them on the shared facts through the registry merge", () => {
      expect(normalizeEventName("codex.sandbox_outcome")).toBe("tool_result");
      expect(
        normalizeEventName("github.copilot.session_compaction_complete"),
      ).toBe("compaction");
      expect(normalizeEventName("github.copilot.skill_invoked")).toBe(
        "skill_activated",
      );
      expect(normalizeEventName("gemini_cli.tool_call")).toBe("tool_result");
      expect(normalizeEventName("gemini_cli.chat_compression")).toBe(
        "compaction",
      );
      expect(normalizeMetricName("codex.turn.token_usage")).toBe("token_usage");
      expect(normalizeMetricName("gemini_cli.lines.changed")).toBe(
        "lines_of_code",
      );
    });
  });

  describe("given two tables that disagree on one alias", () => {
    it("refuses to merge them, so a wiring bug fails at module load", () => {
      expect(() =>
        mergeAliasTables({ tool_call: "tool_result" }, [
          { tool_call: "compaction" },
        ]),
      ).toThrow(/Conflicting coding-agent alias "tool_call"/);
    });

    it("accepts a duplicate that agrees — same spelling, same fact", () => {
      expect(
        mergeAliasTables({ tool_call: "tool_result" }, [
          { tool_call: "tool_result" },
        ]),
      ).toEqual({ tool_call: "tool_result" });
    });
  });

  describe("given the LangWatch companion event", () => {
    it("lands the qualified and bare spellings on one fact", () => {
      // `langwatch.` is nobody's agent prefix, so nothing is stripped and the
      // dot-flattened spelling is what the alias table has to carry.
      expect(normalizeEventName("langwatch.session_context")).toBe(
        "session_context",
      );
      expect(normalizeEventName("session_context")).toBe("session_context");
    });
  });

  describe("given Claude's response-body half of a model call", () => {
    it("lands it on the same fact as Gemini's completion event", () => {
      expect(normalizeEventName("claude_code.api_response_body")).toBe(
        "api_response",
      );
      expect(normalizeEventName("gemini_cli.api_response")).toBe(
        "api_response",
      );
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

describe("liftCodingAgentLogFacts", () => {
  describe("given a log record named langwatch.session_context under the langwatch hook scope", () => {
    const attributes = {
      "event.name": SESSION_CONTEXT_EVENT_NAME,
      "session.id": "sess-ctx-1",
      "coding_agent.name": "claude_code",
      "vcs.repository.host": "github.com",
      "vcs.repository.owner": "acme",
      "vcs.repository.name": "widgets",
      "vcs.ref.head.name": "feat/session-git-context",
      "vcs.worktree.name": "widgets-feat",
    };

    /** @scenario A langwatch session context event passes the log lift without a vendor scope */
    it("admits the record and lifts its vcs attributes", () => {
      const facts = liftCodingAgentLogFacts({
        scopeName: "langwatch.coding_agent.hook",
        attributes,
      });

      expect(facts).toEqual(attributes);
    });

    /** @scenario A langwatch session context event passes the log lift without a vendor scope */
    it("required no vendor instrumentation scope to be admitted", () => {
      // The proof that the admission is the event name and nothing else: the
      // same scope and name name no agent at all.
      expect(
        detectCodingAgent({
          scopeName: "langwatch.coding_agent.hook",
          recordName: SESSION_CONTEXT_EVENT_NAME,
        }),
      ).toBe("unknown");
    });
  });

  describe("given an ordinary application log", () => {
    it("declines it, so the firehose costs one name check", () => {
      expect(
        liftCodingAgentLogFacts({
          scopeName: "express",
          attributes: { "event.name": "http.request", "session.id": "s" },
        }),
      ).toBeNull();
    });
  });
});

describe("declaredCodingAgent", () => {
  describe("given a declaration naming an agent in the registry", () => {
    it("answers that agent", () => {
      expect(declaredCodingAgent({ "coding_agent.name": "claude_code" })).toBe(
        "claude_code",
      );
      expect(declaredCodingAgent({ "coding_agent.name": "codex" })).toBe(
        "codex",
      );
    });
  });

  describe("given a declaration LangWatch cannot resolve", () => {
    it("answers null rather than trusting the wire", () => {
      expect(
        declaredCodingAgent({ "coding_agent.name": "totally_new_agent" }),
      ).toBeNull();
      expect(declaredCodingAgent({ "coding_agent.name": "" })).toBeNull();
      expect(declaredCodingAgent({ "coding_agent.name": 42 })).toBeNull();
      expect(declaredCodingAgent({})).toBeNull();
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
