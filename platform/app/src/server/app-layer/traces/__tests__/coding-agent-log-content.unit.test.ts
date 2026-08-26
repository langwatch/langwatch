/**
 * The content-key table behind both the read-path enrichment and the API's log
 * redaction.
 *
 * The guard at the bottom is the point of the file: it reads the transcript
 * derivation's own source and fails if the derivation surfaces a log attribute
 * the table does not classify. That is exactly the drift that let namespaced
 * agents (codex, gemini) return restricted content to a session-less caller —
 * the derivation resolved their events through the canonical vocabulary while
 * the gate matched claude's bare wire spelling and so found nothing to hide.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { contentAttrKeys, logContentKeys } from "@langwatch/coding-agent-contract";

function categoryOf(eventName: string, key: string): string | undefined {
  return logContentKeys(eventName).find((entry) => entry.key === key)?.category;
}

describe("logContentKeys", () => {
  describe("given claude's bare wire spelling", () => {
    it("gates the prompt on input and the reply on output", () => {
      expect(categoryOf("user_prompt", "prompt")).toBe("input");
      expect(categoryOf("assistant_response", "response")).toBe("output");
    });

    it("withholds tool_input and tool_parameters for tool_result", () => {
      expect(contentAttrKeys("tool_result")).toContain("tool_input");
      expect(contentAttrKeys("tool_result")).toContain("tool_parameters");
      expect(categoryOf("tool_result", "tool_input")).toBe("input");
    });

    it("withholds tool_parameters for tool_decision", () => {
      expect(contentAttrKeys("tool_decision")).toContain("tool_parameters");
      expect(categoryOf("tool_decision", "tool_parameters")).toBe("input");
    });

    it("keeps the raw request payload on input, its un-aliased name and all", () => {
      expect(categoryOf("api_request_body", "body")).toBe("input");
      expect(categoryOf("api_response_body", "body")).toBe("output");
    });
  });

  describe("given a namespaced wire spelling", () => {
    it("resolves codex events through the canonical vocabulary", () => {
      expect(categoryOf("codex.user_prompt", "prompt")).toBe("input");
      expect(categoryOf("codex.tool_result", "arguments")).toBe("input");
      expect(categoryOf("codex.tool_result", "output")).toBe("output");
    });

    it("resolves gemini events, whose reply rides response_text", () => {
      expect(categoryOf("gemini_cli.user_prompt", "prompt")).toBe("input");
      expect(categoryOf("gemini_cli.api_response", "response_text")).toBe("output");
      expect(categoryOf("gemini_cli.tool_call", "function_args")).toBe("input");
    });
  });

  describe("given an event the table does not know", () => {
    it("fails closed: its body needs both categories", () => {
      expect(categoryOf("something_new", "body")).toBe("both");
    });

    /**
     * The bypass this PR closes was "the record matches no known content key,
     * so nothing is withheld". An unaliased event would reopen it if the
     * fallback only covered `body`.
     */
    it("withholds every content key the table knows, not just the body", () => {
      const keys = logContentKeys("brand_new_agent.some_event");

      for (const key of ["prompt", "response", "response_text", "output"]) {
        expect(keys.map((entry) => entry.key)).toContain(key);
        expect(categoryOf("brand_new_agent.some_event", key)).toBe("both");
      }
    });

    it("keeps the enrichment probe on the plain body convention", () => {
      // Guessing a content key for an unknown event would surface the wrong
      // attribute as span content. Over-hiding is safe; mis-showing is not.
      expect(contentAttrKeys("brand_new_agent.some_event")).toEqual(["body"]);
    });
  });

  /**
   * The gate must never withhold less than the enrichment surfaces, or content
   * reaches a reader through a key the gate does not know about.
   */
  describe("given any event", () => {
    it("gates at least every key the enrichment probe can surface", () => {
      for (const eventName of [
        "user_prompt",
        "assistant_response",
        "api_request_body",
        "api_response_body",
        "codex.tool_result",
        "gemini_cli.api_response",
        "gemini_cli.tool_call",
        "tool_decision",
        "commit",
        "brand_new_agent.some_event",
      ]) {
        const gated = new Set(logContentKeys(eventName).map((entry) => entry.key));
        for (const key of contentAttrKeys(eventName)) {
          expect(gated).toContain(key);
        }
      }
    });
  });

  describe("given free text the agent wrote about the session", () => {
    it("needs both categories, since it quotes either side", () => {
      expect(categoryOf("session_error", "error")).toBe("both");
      expect(categoryOf("subtask_invoked", "description")).toBe("both");
      expect(categoryOf("commit", "message")).toBe("both");
    });
  });
});

/**
 * The transcript derivation reads log attributes by name through
 * `readString(attrs, "…")`. Every one of those names that carries content has
 * to be in the table, or the endpoint surfaces something the gate never sees.
 * Metadata names (ids, counts, model names, decisions) are listed as known-safe
 * so a genuinely new content key cannot hide among them.
 */
const KNOWN_METADATA_ATTRS: ReadonlySet<string> = new Set([
  "event.name",
  "call_id",
  "tool_name",
  "mcp_server",
  "function_name",
  "decision",
  "source",
  "success",
  "duration_ms",
  "prompt_length",
  "model",
  "role",
  "pre_tokens",
  "post_tokens",
  "trigger",
  "to_mode",
  "status_code",
  "skill_name",
  "skill",
]);

describe("the derivation cannot read a content attribute the table misses", () => {
  it("classifies every log attribute the transcript derivation reads", () => {
    const services = [
      "coding-agent-transcript-log.ts",
      "coding-agent-transcript-note.ts",
      "coding-agent-transcript-state.ts",
    ];
    const derivation = services
      .map((file) =>
        readFileSync(
          join(process.cwd(), "../../packages/features/coding-agent/contract/src", file),
          "utf8",
        ),
      )
      .join("\n");
    // `readString(attrs, "x")` / `readNumber(attrs, "x")` — the only way the
    // derivation reaches a log attribute by name.
    const read = [
      ...derivation.matchAll(/read(?:String|Number)\(attrs, "([^"]+)"\)/g),
    ].map((match) => match[1]!);
    // A guard that matches nothing passes for the wrong reason. These are the
    // attributes the derivation demonstrably reads today, so if it moves to a
    // different accessor the count collapses and this fails rather than going
    // quietly green.
    expect(read).toContain("prompt");
    expect(read).toContain("response");
    expect(read).toContain("response_text");
    expect(read.length).toBeGreaterThan(15);

    const classified = new Set<string>();
    for (const eventName of [
      "user_prompt",
      "assistant_response",
      "api_request_body",
      "api_response_body",
      "gemini_cli.api_response",
      "codex.tool_result",
      "gemini_cli.tool_call",
      "tool_decision",
      "session_error",
      "internal_error",
      "subtask_invoked",
      "commit",
    ]) {
      for (const key of contentAttrKeys(eventName)) classified.add(key);
    }

    const unclassified = [...new Set(read)].filter(
      (attr) => !classified.has(attr) && !KNOWN_METADATA_ATTRS.has(attr),
    );

    expect(unclassified).toEqual([]);
  });
});
