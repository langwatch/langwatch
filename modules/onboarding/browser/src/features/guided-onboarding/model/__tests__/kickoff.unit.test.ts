/**
 * The kickoff message the tour hands to Langy: the typed part the panel
 * renders, the brief the model reads, and what the panel does with each.
 *
 * @see specs/langy/langy-guided-onboarding.feature
 */
import { GUIDED_ONBOARDING_KICKOFF_PART_TYPE } from "@langwatch/onboarding-contract";
import { describe, expect, it } from "vitest";

import {
  buildGuidedKickoffBrief,
  buildGuidedKickoffParts,
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

    /** @scenario "The brief names the key the tour minted, by its reveal id" */
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

    /** @scenario "The brief's data lines end on their values" */
    it("writes every line after the opener as a label, a colon and its value, with no sentence stop", () => {
      const [, ...data] = buildGuidedKickoffBrief({ input: KICKOFF }).split("\n");

      expect(data.length).toBeGreaterThan(0);
      for (const line of data) {
        expect(line).toMatch(/^[^:]+: \S.*$/);
        expect(line.endsWith(".")).toBe(false);
      }
    });

    /** @scenario "The brief names the instance's gateway" */
    it("carries the gateway address, or says none is configured, and never names a hosted gateway", () => {
      const served = buildGuidedKickoffBrief({ input: KICKOFF }).split("\n");
      const unserved = buildGuidedKickoffBrief({
        input: { ...KICKOFF, gatewayUrl: undefined },
      }).split("\n");

      expect(served).toContain("Gateway: https://gateway.acme.example/v1");
      expect(unserved).toContain("Gateway: none configured on this instance");
      expect([...served, ...unserved].join("\n")).not.toMatch(/hosted|gateway\.langwatch/i);
    });

    /** @scenario "The brief names the key the tour minted, by its reveal id" */
    it("says no key was minted when the tour minted none", () => {
      const brief = buildGuidedKickoffBrief({ input: KICKOFF });

      expect(brief.split("\n")).toContain("Virtual key: none minted by the tour");
      expect(brief).not.toContain("secret_snippet");
    });

    it("prefixes a continuation line when continuing an existing conversation", () => {
      const brief = buildGuidedKickoffBrief({ input: KICKOFF, continuing: true });
      expect(brief.split("\n")[0]).toBe("Let's set up Evals & LLM Ops then.");
    });

    /** @scenario "A queued kickoff for an attached conversation continues that conversation" */
    it("opens the brief with the path's continuation line for an attached conversation", () => {
      const plan = planGuidedKickoffSend({
        kickoff: { ...KICKOFF, path: "gateway", conversationId: "conv_1" },
        organizationId: "org_1",
      });

      expect(plan.brief.split("\n")[0]).toBe("Let's set up Gateway then.");
    });

    /** @scenario "A queued kickoff with no attached conversation starts a fresh one" */
    it("opens the brief with the opener alone when there is no conversation to continue", () => {
      const plan = planGuidedKickoffSend({ kickoff: KICKOFF, organizationId: "org_1" });

      expect(plan.brief.split("\n")[0]).toBe("Guided onboarding kickoff.");
    });
  });

  describe("when settling the kickoff against stored state", () => {
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

    /** @scenario "The settled Virtual key line tells Langy what to do with the reveal" */
    it("settles the Virtual key line from the stored key, or to none minted", () => {
      const parts = buildGuidedKickoffParts({ input: KICKOFF });
      const textOf = (settled: unknown[] | null) => JSON.stringify(settled);
      const withKey = textOf(
        settleGuidedKickoffParts({
          parts,
          facts: guidedKickoffStateFactsOf({
            virtualKeyName: "onboarding-key",
            virtualKeyPreview: "vk-lw-abc",
            virtualKeyRevealId: "reveal-1",
          }),
        }),
      );
      const withoutKey = textOf(
        settleGuidedKickoffParts({ parts, facts: guidedKickoffStateFactsOf({}) }),
      );

      expect(withKey).toContain(
        "Virtual key: onboarding-key is live (preview vk-lw-abc, reveal id reveal-1). Show it with secret_snippet using this reveal id. Do not list, ask or create keys.",
      );
      expect(withoutKey).toContain("Virtual key: none minted by the tour");
      expect(withoutKey).not.toContain("secret_snippet");
    });

    it("returns null when the parts carry no kickoff", () => {
      expect(
        settleGuidedKickoffParts({ parts: [{ type: "text", text: "hi" }], facts: { paths: [] } }),
      ).toBeNull();
    });
  });

  describe("when planning the send", () => {
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

  describe("when building the tour card rows", () => {
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
