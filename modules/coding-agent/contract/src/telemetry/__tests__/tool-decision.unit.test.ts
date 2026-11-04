import { describe, expect, it } from "vitest";

import { toolDecisionOutcome } from "../tool-decision.ts";

const outcome = (decision: string | null, source: string | null = null) =>
  toolDecisionOutcome({ decision, source });

describe("toolDecisionOutcome", () => {
  it("reads Claude's accept and reject, and a walk-away from its source", () => {
    expect(outcome("accept")).toBe("allowed");
    expect(outcome("reject")).toBe("denied");
    expect(outcome("reject", "user_abort")).toBe("aborted");
  });

  it("reads Codex's approved, denied, abort and timed_out spellings", () => {
    expect(outcome("approved")).toBe("allowed");
    expect(outcome("approved_for_session")).toBe("allowed");
    expect(outcome("denied")).toBe("denied");
    expect(outcome("denied_with_network_policy_deny")).toBe("denied");
    expect(outcome("abort")).toBe("aborted");
    expect(outcome("timed_out")).toBe("aborted");
  });

  it("reads Grok's allow, deny, followup and cancelled", () => {
    expect(outcome("allow")).toBe("allowed");
    expect(outcome("deny")).toBe("denied");
    expect(outcome("followup")).toBe("denied");
    expect(outcome("cancelled")).toBe("aborted");
  });

  it("names nothing for a missing or unknown decision", () => {
    expect(outcome(null)).toBe("unknown");
    expect(outcome("maybe")).toBe("unknown");
  });
});
