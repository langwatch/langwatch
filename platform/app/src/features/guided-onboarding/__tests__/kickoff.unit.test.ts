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
} from "../kickoff";

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
      expect(lines).toContain("Path to set up now: llmops (Evals & LLM Ops)");
      expect(lines).toContain(
        "Everything picked, in the order it was picked: llmops (Evals & LLM Ops), governance (Governance)",
      );
      expect(lines).toContain("Provider: OpenAI, model gpt-5");
      expect(lines).toContain("Organization: ACME");
      expect(lines).toContain("First name: Ada");
      expect(lines).toContain("Tour: completed");
    });

    /** @scenario "The brief's data lines end on their values" */
    it("ends every data line on its value, with no sentence stop after it", () => {
      const lines = buildGuidedKickoffBrief({ input: KICKOFF })
        .split("\n")
        .slice(1);
      expect(lines.length).toBeGreaterThanOrEqual(6);
      for (const line of lines) {
        expect(line, line).toMatch(/^[A-Z][^:]+: \S/);
        expect(line.endsWith("."), line).toBe(false);
      }
    });

    /** @scenario "The brief names the instance's gateway" */
    it("names the gateway URL the instance serves, or that none is configured", () => {
      expect(buildGuidedKickoffBrief({ input: KICKOFF }).split("\n")).toContain(
        "Gateway: https://gateway.acme.example/v1",
      );
      const { gatewayUrl: _omitted, ...withoutGateway } = KICKOFF;
      expect(buildGuidedKickoffBrief({ input: withoutGateway })).toContain(
        "Gateway: none configured on this instance",
      );
      expect(buildGuidedKickoffBrief({ input: KICKOFF })).not.toContain(
        "gateway.langwatch.ai",
      );
    });

    /** @scenario "The brief names the key the tour minted, by its reveal id" */
    it("names the tour's virtual key by name, prefix and reveal id, never by its secret", () => {
      const brief = buildGuidedKickoffBrief({
        input: {
          ...KICKOFF,
          virtualKeyName: "production-app",
          virtualKeyPreview: "vk-lw-01HZX9N",
          virtualKeyRevealId: "rvl_abc123",
        },
      });
      expect(brief.split("\n")).toContain(
        "Virtual key: production-app is live (preview vk-lw-01HZX9N, reveal id rvl_abc123). Show it with secret_snippet using this reveal id. Do not list, ask or create keys.",
      );
      expect(buildGuidedKickoffBrief({ input: KICKOFF })).toContain(
        "Virtual key: none minted by the tour",
      );
    });

    it("says when no provider was connected", () => {
      const brief = buildGuidedKickoffBrief({
        input: { ...KICKOFF, provider: undefined, providerModel: undefined },
      });
      expect(brief).toContain("Provider: none connected yet");
    });

    it("treats a lone path as its own pick when the picks are empty", () => {
      const brief = buildGuidedKickoffBrief({
        input: { ...KICKOFF, paths: [] },
      });
      expect(brief).toContain(
        "Everything picked, in the order it was picked: llmops (Evals & LLM Ops)",
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

describe("settleGuidedKickoffParts", () => {
  const snapshot = buildGuidedKickoffParts({
    input: {
      path: "gateway",
      paths: ["gateway"],
      orgName: "ACME",
      firstName: "Ada",
      tourStatus: "completed",
      gatewayUrl: "https://gateway.acme.example/v1",
    },
  });

  describe("given a kickoff the panel composed before the tour's key was recorded", () => {
    const recordedLater = guidedKickoffStateFactsOf({
      paths: ["gateway", "llmops"],
      gatewayUrl: "https://gateway.acme.example/v1",
      virtualKeyName: "production-app",
      virtualKeyPreview: "vk-lw-01M1X40",
      virtualKeyRevealId: "rvl_late",
    });

    /** @scenario "The brief's state lines are settled on the server from the stored guided state" */
    it("rebuilds the typed part and the brief from the stored state, and keeps what the panel alone knows", () => {
      expect(snapshot[1].text).toContain(
        "Virtual key: none minted by the tour",
      );

      const settled = settleGuidedKickoffParts({
        parts: snapshot,
        facts: recordedLater,
      });

      expect(settled).not.toBeNull();
      const [typed, brief] = settled as [
        Record<string, unknown>,
        { type: string; text: string },
      ];
      expect(typed).toMatchObject({
        type: "guided-onboarding-kickoff",
        path: "gateway",
        paths: ["gateway", "llmops"],
        orgName: "ACME",
        firstName: "Ada",
        tourStatus: "completed",
        virtualKeyName: "production-app",
        virtualKeyPreview: "vk-lw-01M1X40",
        virtualKeyRevealId: "rvl_late",
      });
      expect(brief.type).toBe("text");
      expect(brief.text).toContain(
        "Virtual key: production-app is live (preview vk-lw-01M1X40, reveal id rvl_late)",
      );
      expect(brief.text).toContain(
        "Everything picked, in the order it was picked: gateway (Gateway), llmops (Evals & LLM Ops)",
      );
      expect(brief.text).toContain("Organization: ACME");
      expect(brief.text).toContain("First name: Ada");
      expect(brief.text).toContain("Tour: completed");
      expect(brief.text).not.toContain("none minted by the tour");
    });

    it("keeps the continuation line of a kickoff that continues a conversation", () => {
      const continuing = buildGuidedKickoffParts({
        input: {
          path: "gateway",
          paths: ["llmops", "gateway"],
          tourStatus: "completed",
        },
        continuing: true,
      });
      const settled = settleGuidedKickoffParts({
        parts: continuing,
        facts: recordedLater,
      }) as [unknown, { text: string }];
      expect(settled[1].text.startsWith("Let's set up Gateway then.\n")).toBe(
        true,
      );
      expect(settled[1].text).toContain("reveal id rvl_late");
    });

    /** @scenario "The settled Virtual key line tells Langy what to do with the reveal" */
    it("writes the instruction into the Virtual key line when the state holds a reveal, and the none line when it holds none", () => {
      const withReveal = settleGuidedKickoffParts({
        parts: snapshot,
        facts: recordedLater,
      }) as [unknown, { text: string }];
      expect(withReveal[1].text.split("\n")).toContain(
        "Virtual key: production-app is live (preview vk-lw-01M1X40, reveal id rvl_late). Show it with secret_snippet using this reveal id. Do not list, ask or create keys.",
      );

      const withoutReveal = settleGuidedKickoffParts({
        parts: snapshot,
        facts: guidedKickoffStateFactsOf({ paths: ["gateway", "llmops"] }),
      }) as [unknown, { text: string }];
      expect(withoutReveal[1].text.split("\n")).toContain(
        "Virtual key: none minted by the tour",
      );
      expect(withoutReveal[1].text).not.toContain("secret_snippet");
    });

    it("carries no virtual key field at all when the state recorded none", () => {
      const sentWithStaleKey = buildGuidedKickoffParts({
        input: {
          path: "gateway",
          paths: ["gateway"],
          tourStatus: "skipped",
          virtualKeyName: "production-app",
          virtualKeyPreview: "vk-lw-01M1X40",
          virtualKeyRevealId: "rvl_stale",
        },
      });
      const settled = settleGuidedKickoffParts({
        parts: sentWithStaleKey,
        facts: guidedKickoffStateFactsOf({ paths: ["gateway"] }),
      })!;

      // Present with no value is not the same as absent: the part travels as
      // a command payload, and a field set to undefined fails its schema.
      const typed = settled[0] as Record<string, unknown>;
      expect(Object.keys(typed)).not.toContain("virtualKeyName");
      expect(Object.keys(typed)).not.toContain("virtualKeyPreview");
      expect(Object.keys(typed)).not.toContain("virtualKeyRevealId");
      expect(JSON.parse(JSON.stringify(typed))).toEqual(typed);
      expect((settled[1] as { text: string }).text).toContain(
        "Virtual key: none minted by the tour",
      );
    });

    it("leaves every other part where it was", () => {
      const extra = { type: "file", url: "https://acme.example/a.png" };
      const settled = settleGuidedKickoffParts({
        parts: [extra, ...snapshot],
        facts: recordedLater,
      });
      expect(settled?.[0]).toBe(extra);
      expect(settled).toHaveLength(3);
    });
  });

  describe("given a message that is not a kickoff", () => {
    it("answers null", () => {
      expect(
        settleGuidedKickoffParts({
          parts: [{ type: "text", text: "hello" }],
          facts: guidedKickoffStateFactsOf({}),
        }),
      ).toBeNull();
    });
  });
});

describe("guidedKickoffStateFactsOf", () => {
  it("reads the settled fields off a state view and nothing else", () => {
    expect(
      guidedKickoffStateFactsOf({
        paths: ["gateway"],
        provider: "OpenAI",
        providerModel: "gpt-5",
        gatewayUrl: "https://gateway.acme.example/v1",
        virtualKeyName: "production-app",
        virtualKeyPreview: "vk-lw-01M1X40",
        virtualKeyRevealId: "rvl_abc",
        ...({ currentPath: "gateway", conversationId: "conv-1" } as object),
      }),
    ).toEqual({
      paths: ["gateway"],
      provider: "OpenAI",
      providerModel: "gpt-5",
      gatewayUrl: "https://gateway.acme.example/v1",
      virtualKeyName: "production-app",
      virtualKeyPreview: "vk-lw-01M1X40",
      virtualKeyRevealId: "rvl_abc",
    });
  });
});
