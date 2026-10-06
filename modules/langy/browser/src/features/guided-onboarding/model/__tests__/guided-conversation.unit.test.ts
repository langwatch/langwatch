/**
 * What the transcript says about a guided path, read from the parts it carries.
 * @see specs/langy/langy-guided-onboarding.feature
 */
import { describe, expect, it } from "vitest";

import { guidedPathInProgress } from "../guided-conversation.ts";

const kickoff = {
  role: "user",
  parts: [
    {
      type: "guided-onboarding-kickoff",
      path: "llmops",
      paths: ["llmops"],
      provider: "OpenAI",
      providerModel: "gpt-5",
      orgName: "ACME",
      tourStatus: "completed",
    },
    { type: "text", text: "Guided onboarding kickoff." },
  ],
};

const midPathReply = {
  role: "assistant",
  parts: [
    {
      type: "tool-bash",
      state: "output-available",
      input: { command: "langwatch onboarding state" },
      output: "ok",
    },
    { type: "text", text: "Setting up tracing." },
  ],
};

const closingReply = {
  role: "assistant",
  parts: [
    {
      type: "tool-bash",
      state: "output-available",
      input: { command: "langwatch onboarding complete-path llmops" },
      output: "Coding Agent Tracking set up",
    },
  ],
};

describe("given a conversation that carries the kickoff", () => {
  describe("when no reply since the kickoff ran complete-path", () => {
    /** @scenario No feedback ask while the guided path runs */
    it("reports the path in progress, which is what holds the feedback ask", () => {
      expect(guidedPathInProgress([kickoff])).toBe(true);
      expect(guidedPathInProgress([kickoff, midPathReply])).toBe(true);
    });
  });

  describe("when a reply since the kickoff closed the path", () => {
    /** @scenario No feedback ask while the guided path runs */
    it("reports the path closed, so the ask may show after the pull request card", () => {
      expect(guidedPathInProgress([kickoff, midPathReply, closingReply])).toBe(false);
    });
  });

  describe("when a later kickoff starts another path", () => {
    it("reads only the replies after the newest kickoff", () => {
      expect(guidedPathInProgress([kickoff, closingReply, kickoff, midPathReply])).toBe(true);
    });
  });
});

describe("given a conversation without a kickoff", () => {
  it("holds nothing back", () => {
    expect(guidedPathInProgress([midPathReply])).toBe(false);
  });
});
