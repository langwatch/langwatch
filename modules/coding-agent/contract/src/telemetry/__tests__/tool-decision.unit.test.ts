import { describe, expect, it } from "vitest";

import { toolDecisionByUser, toolDecisionOutcome } from "../tool-decision.ts";

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

  it("reads Grok's allow, deny, cancelled, and followup as a redirect", () => {
    expect(outcome("allow", "allowed")).toBe("allowed");
    expect(outcome("deny", "user_reject")).toBe("denied");
    expect(outcome("deny", "config")).toBe("denied");
    expect(outcome("followup", "user_followup")).toBe("redirected");
    expect(outcome("cancelled", "user_abort")).toBe("aborted");
  });

  it("names nothing for a missing or unknown decision", () => {
    expect(outcome(null)).toBe("unknown");
    expect(outcome("maybe")).toBe("unknown");
  });
});

describe("toolDecisionByUser", () => {
  it("names the user for Claude's and Grok's user_* sources", () => {
    for (const source of ["user_reject", "user_temporary", "user_permanent", "user_followup"]) {
      expect(toolDecisionByUser({ source })).toBe(true);
    }
  });

  it("names the user for Codex's User source, whatever its case", () => {
    expect(toolDecisionByUser({ source: "User" })).toBe(true);
    expect(toolDecisionByUser({ source: "user" })).toBe(true);
  });

  it("does not name the user for a rule, hook, classifier or reviewer", () => {
    for (const source of ["config", "Config", "hook", "classifier", "AutomatedReviewer"]) {
      expect(toolDecisionByUser({ source })).toBe(false);
    }
  });

  it("does not name the user when no source was sent", () => {
    expect(toolDecisionByUser({ source: null })).toBe(false);
  });
});
