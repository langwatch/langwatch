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
  guidedTourCardRows,
  planGuidedKickoffSend,
} from "../kickoff";

const KICKOFF: GuidedKickoffInput = {
  path: "llmops",
  paths: ["llmops", "governance"],
  provider: "OpenAI",
  providerModel: "gpt-5",
  orgName: "ACME",
  firstName: "Ada",
  tourStatus: "completed",
};

describe("the guided onboarding kickoff", () => {
  describe("given the takeover's picks", () => {
    /** @scenario "The kickoff message carries the typed part beside the model brief" */
    it("builds the typed part first and the text brief second", () => {
      const [part, text] = buildGuidedKickoffParts({ input: KICKOFF });
      expect(part).toEqual({
        type: GUIDED_ONBOARDING_KICKOFF_PART_TYPE,
        ...KICKOFF,
      });
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
      expect(lines).toContain("Path to set up now: llmops (Evals & LLM Ops).");
      expect(lines).toContain(
        "Everything picked, in the order it was picked: llmops (Evals & LLM Ops), governance (Governance).",
      );
      expect(lines).toContain("Provider: OpenAI, model gpt-5.");
      expect(lines).toContain("Organization: ACME. First name: Ada.");
      expect(lines).toContain("Tour: completed.");
    });

    it("says when no provider was connected", () => {
      const brief = buildGuidedKickoffBrief({
        input: { ...KICKOFF, provider: undefined, providerModel: undefined },
      });
      expect(brief).toContain("Provider: none connected yet.");
    });

    it("treats a lone path as its own pick when the picks are empty", () => {
      const brief = buildGuidedKickoffBrief({
        input: { ...KICKOFF, paths: [] },
      });
      expect(brief).toContain(
        "Everything picked, in the order it was picked: llmops (Evals & LLM Ops).",
      );
    });
  });

  describe("given a message that is not a kickoff", () => {
    it("finds no kickoff part", () => {
      expect(guidedKickoffPartOf([{ type: "text", text: "hello" }])).toBeNull();
      expect(guidedKickoffPartOf(undefined)).toBeNull();
      expect(
        guidedKickoffPartOf([
          { type: GUIDED_ONBOARDING_KICKOFF_PART_TYPE, path: "nope" },
        ]),
      ).toBeNull();
    });
  });

  describe("given a queued kickoff without a conversation", () => {
    /** @scenario "The panel attaches a fresh kickoff conversation to the organization" */
    it("starts fresh and plans to attach the conversation the transport names", () => {
      const plan = planGuidedKickoffSend({
        kickoff: KICKOFF,
        organizationId: "org_1",
      });
      expect(plan.continuing).toBe(false);
      expect(plan.attachToOrganizationId).toBe("org_1");
      expect(plan.brief).not.toContain("Let's set up");
      expect(plan.parts[0].type).toBe(GUIDED_ONBOARDING_KICKOFF_PART_TYPE);
    });
  });

  describe("given a queued kickoff for an attached conversation", () => {
    /** @scenario "A queued kickoff for an attached conversation continues that conversation" */
    it("continues it, opens with the continuation line and attaches nothing", () => {
      const plan = planGuidedKickoffSend({
        kickoff: { ...KICKOFF, path: "gateway", conversationId: "conv_1" },
        organizationId: "org_1",
      });
      expect(plan.continuing).toBe(true);
      expect(plan.attachToOrganizationId).toBeNull();
      expect(plan.brief.split("\n")[0]).toBe("Let's set up Gateway then.");
      expect(plan.parts[0]).not.toHaveProperty("conversationId");
    });
  });

  describe("given the tour card rows", () => {
    /** @scenario "Expanding the card shows what the takeover collected" */
    it("lists who it is for, the picks by title and the provider with its model", () => {
      expect(guidedTourCardRows(KICKOFF)).toEqual([
        ["Setting up for", "ACME"],
        ["You picked", "Evals & LLM Ops, Governance"],
        ["Provider", "OpenAI · gpt-5"],
      ]);
    });

    /** @scenario "A kickoff without a provider shows no provider row" */
    it("drops the provider row when none was recorded", () => {
      const rows = guidedTourCardRows({ ...KICKOFF, provider: undefined });
      expect(rows.map(([label]) => label)).toEqual([
        "Setting up for",
        "You picked",
      ]);
    });

    /** @scenario "A kickoff without an organization name sets up for you" */
    it("sets up for you when the organization has no name", () => {
      expect(guidedTourCardRows({ ...KICKOFF, orgName: "  " })[0]).toEqual([
        "Setting up for",
        "you",
      ]);
    });
  });
});
