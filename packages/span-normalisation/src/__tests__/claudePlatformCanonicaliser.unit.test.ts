import { describe, expect, it } from "vitest";

import { ATTR_KEYS } from "../attributeKeys.ts";
import { canonicaliseSpanAttributes, orderedSpanCanonicalisers } from "../spanCanonicalisation.ts";

const codexScopes = { isCodexScope: () => false, execScope: "codex_exec" };

const usage = { "gen_ai.usage.input_tokens": 120, "gen_ai.usage.output_tokens": 30 };

function canonicalise({ name, scope }: { name: string; scope: string }) {
  return canonicaliseSpanAttributes({
    canonicalisers: orderedSpanCanonicalisers({ codexScopes }),
    spanAttributes: { "gen_ai.provider.name": "anthropic", ...usage },
    events: [],
    span: {
      name,
      kind: 2,
      instrumentationScope: { name: scope, version: null },
      statusMessage: null,
      statusCode: null,
      parentSpanId: null,
    },
  });
}

const skipped = (attributes: Record<string, unknown>) =>
  attributes[ATTR_KEYS.LANGWATCH_RESERVED_SKIP_TOKEN_ACCUMULATION];

describe("ClaudePlatformCanonicaliserService", () => {
  /** @scenario "The API request span's repeated usage is not summed" */
  it("marks the API messages.create span to skip token accumulation", () => {
    const result = canonicalise({
      name: "anthropic.messages.create",
      scope: "com.anthropic.claude-platform",
    });

    expect(skipped(result.attributes)).toBe("true");
    expect(result.appliedRules).toContain("claude-platform:skip-request-rollup-usage");
  });

  /** @scenario "An API step span's own usage is summed" */
  it.each([
    "anthropic.model_request",
    "anthropic.compaction",
    "anthropic.session.outcome_evaluation",
  ])("keeps the usage of %s", (name) => {
    const result = canonicalise({ name, scope: "com.anthropic.claude-platform" });

    expect(skipped(result.attributes)).toBeUndefined();
  });

  /** @scenario "A Claude SDK client span keeps its usage" */
  it("leaves the SDK client span alone, since it may be the only span with the usage", () => {
    const result = canonicalise({
      name: "anthropic.messages.create",
      scope: "com.anthropic.sdk.python",
    });

    expect(skipped(result.attributes)).toBeUndefined();
  });
});
