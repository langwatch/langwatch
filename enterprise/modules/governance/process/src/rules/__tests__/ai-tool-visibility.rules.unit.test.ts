import { describe, expect, it } from "vitest";

import { selectClaudeCodeOtlpEndpoint } from "../ai-tool-visibility.rules.ts";

const source = (id: string, sourceType: string, status: string, createdAtMs: number) => ({
  id,
  sourceType,
  status,
  createdAtMs,
});

describe("selectClaudeCodeOtlpEndpoint", () => {
  it("points at the oldest Claude Code source that is not disabled", () => {
    expect(
      selectClaudeCodeOtlpEndpoint([
        source("newer", "claude_code", "active", 2),
        source("disabled", "claude_code", "disabled", 0),
        source("cursor", "cursor", "active", 0),
        source("older", "claude_code", "awaiting_first_event", 1),
      ]),
    ).toEqual({ endpoint: "/api/ingest/otel/older" });
  });

  it("answers null when no Claude Code source is published", () => {
    expect(selectClaudeCodeOtlpEndpoint([source("cursor", "cursor", "active", 0)])).toEqual({
      endpoint: null,
    });
  });
});
