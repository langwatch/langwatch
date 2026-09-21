/**
 * The kickoff message the tour hands to Langy: the typed part the panel
 * renders, the brief the model reads, and what the panel does with each.
 *
 * @see specs/langy/langy-guided-onboarding.feature
 */
import { describe, expect, it } from "vitest";

import {
  buildGuidedKickoffBrief,
  buildGuidedKickoffParts,
  GUIDED_ONBOARDING_KICKOFF_PART_TYPE,
  type GuidedKickoffInput,
  guidedKickoffPartOf,
  guidedKickoffStateFactsOf,
  guidedTourCardRows,
  planGuidedKickoffSend,
  settleGuidedKickoffParts,
} from "../kickoff.ts";

const KICKOFF: GuidedKickoffInput = {
  path: "llmops",
  paths: ["llmops", "governance"],
  provider: "OpenAI",
  providerModel: "gpt-5",
  orgName: "ACME",
  firstName: "Ada",
  tourStatus: "completed",
  gatewayUrl: "https://gateway.acme.example/v1",
};

describe("the guided onboarding kickoff", () => {
  describe("given the takeover's picks", () => {
    /** @scenario "The kickoff message carries the typed part beside the model brief" */
    it("builds the typed part first and the text brief second", () => {
      const [part, text] = buildGuidedKickoffParts({ input: KICKOFF });
      expect(part).toEqual({ type: GUIDED_ONBOARDING_KICKOFF_PART_TYPE, ...KICKOFF });
      expect(text.type).toBe("text");
      expect(text.text).toBe(buildGuidedKickoffBrief({ input: KICKOFF }));
      expect(guidedKickoffPartOf([part, text])).toEqual(part);
    });

    /** @scenario "The brief tells the model everything the takeover collected" */
    it("writes a brief naming the path, every pick in order, the provider, the names, the tour and the skill", () => {
      const brief = buildGuidedKickoffBrief({ input: KICKOFF });
      const lines = brief.split("\n");
      expect(lines[0]).toBe("Guided onboarding kickoff.");
      expect(brief).not.toContain("skill");
      expect(brief).not.toContain("langwatch ");
      expect(lines).toContain("Path to set up now: llmops (Evals & LLM Ops)");
      expect(lines).toContain(
        "Everything picked, in the order it was picked: llmops (Evals & LLM Ops), governance (Governance)",
      );
      expect(lines).toContain("Provider: OpenAI, model gpt-5");
      expect(lines).toContain("Organization: ACME");
      expect(lines).toContain("First name: Ada");
      expect(lines).toContain("Tour: completed");
    });

    it("names no provider when none connected", () => {
      const brief = buildGuidedKickoffBrief({ input: { ...KICKOFF, provider: undefined } });
      expect(brief.split("\n")).toContain("Provider: none connected yet");
    });

    it("carries the virtual key reveal instruction when the tour minted one", () => {
      const brief = buildGuidedKickoffBrief({
        input: {
          ...KICKOFF,
          virtualKeyName: "onboarding-key",
          virtualKeyPreview: "vk-lw-abc",
          virtualKeyRevealId: "reveal-1",
        },
      });
      expect(brief).toContain(
        "Virtual key: onboarding-key is live (preview vk-lw-abc, reveal id reveal-1). Show it with secret_snippet using this reveal id. Do not list, ask or create keys.",
      );
    });

    it("prefixes a continuation line when continuing an existing conversation", () => {
      const brief = buildGuidedKickoffBrief({ input: KICKOFF, continuing: true });
      expect(brief.split("\n")[0]).toBe("Let's set up Evals & LLM Ops then.");
    });
  });

  describe("settling the kickoff against stored state", () => {
    /** @scenario "The kickoff settles its state lines from the durable record before the turn starts" */
    it("replaces the sent state fields with the stored facts and rebuilds the brief", () => {
      const [typed, brief] = buildGuidedKickoffParts({ input: KICKOFF });
      const facts = guidedKickoffStateFactsOf({ provider: "Anthropic", providerModel: "claude" });
      const settled = settleGuidedKickoffParts({ parts: [typed, brief], facts });
      expect(settled).not.toBeNull();
      const settledPart = guidedKickoffPartOf(settled!);
      expect(settledPart?.provider).toBe("Anthropic");
      expect(settledPart?.providerModel).toBe("claude");
    });

    it("returns null when the parts carry no kickoff", () => {
      expect(
        settleGuidedKickoffParts({ parts: [{ type: "text", text: "hi" }], facts: {} }),
      ).toBeNull();
    });
  });

  describe("planning the send", () => {
    it("attaches a fresh kickoff to the organization and does not attach a continuation", () => {
      const fresh = planGuidedKickoffSend({ kickoff: KICKOFF, organizationId: "org_1" });
      expect(fresh.continuing).toBe(false);
      expect(fresh.attachToOrganizationId).toBe("org_1");

      const continuing = planGuidedKickoffSend({
        kickoff: { ...KICKOFF, conversationId: "conv_1" },
        organizationId: "org_1",
      });
      expect(continuing.continuing).toBe(true);
      expect(continuing.attachToOrganizationId).toBeNull();
    });
  });

  describe("the tour card rows", () => {
    it("always shows who it is setting up for and the picks, and the provider only once recorded", () => {
      const withoutProvider = guidedTourCardRows({ ...KICKOFF, provider: undefined });
      expect(withoutProvider).toEqual([
        ["Setting up for", "ACME"],
        ["You picked", "Evals & LLM Ops, Governance"],
      ]);

      const withProvider = guidedTourCardRows(KICKOFF);
      expect(withProvider).toContainEqual(["Provider", "OpenAI · gpt-5"]);
    });
  });
});
