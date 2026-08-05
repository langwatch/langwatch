/**
 * @vitest-environment node
 *
 * Regression: `POST /api/scenarios` used to validate the red-team fields and
 * then never pass them on, so it answered 201 and persisted a standard
 * scenario. Nothing failed — the attack configuration was just gone, and the
 * run that followed used a cooperative user simulator.
 *
 * The cause was two hand-written copies of the same write contract, one per
 * route, only one of which was wired up. These tests cover the shared module
 * that replaced them: what a route hands Prisma, given what a caller sent.
 */
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  RED_TEAM_MAX_PLAN_LENGTH,
  RED_TEAM_MAX_TARGET_LENGTH,
} from "../execution/types";
import {
  mergeRedTeamState,
  normalizeRedTeamWrite,
  redTeamFields,
  redTeamStateIssue,
  touchesRedTeam,
  withApplicableRedTeamConfig,
} from "../red-team-input";
import { toPrismaRedTeamWrite } from "../red-team-prisma";

const schema = z.object(redTeamFields);

describe("the red-team write contract", () => {
  describe("given a caller configuring an attack", () => {
    /** @scenario Configuring an attack persists it, whichever way it was created */
    it("carries every field through to the write", () => {
      const parsed = schema.parse({
        redTeamStrategy: "crescendo",
        redTeamTarget: "get the agent to reveal its override code",
        redTeamTotalTurns: 6,
        redTeamConfig: { scoreResponses: false },
      });

      // The bug in one line: this used to come back empty.
      expect(toPrismaRedTeamWrite(parsed)).toEqual({
        redTeamStrategy: "crescendo",
        redTeamTarget: "get the agent to reveal its override code",
        redTeamTotalTurns: 6,
        redTeamConfig: { scoreResponses: false },
      });
    });
  });

  describe("given a caller who sent no red-team fields at all", () => {
    it("writes nothing, so an update cannot clear what it was not asked to", () => {
      expect(toPrismaRedTeamWrite(schema.parse({}))).toEqual({});
    });
  });

  describe("given a caller turning a red-team scenario back into a standard one", () => {
    /** @scenario Clearing the attack turns the scenario back into a standard one */
    it("clears the columns, spelling the Json null the way Prisma needs", () => {
      const parsed = schema.parse({
        redTeamStrategy: null,
        redTeamTarget: null,
        redTeamTotalTurns: null,
        redTeamConfig: null,
      });

      expect(toPrismaRedTeamWrite(parsed)).toEqual({
        redTeamStrategy: null,
        redTeamTarget: null,
        redTeamTotalTurns: null,
        // Not plain null: on a Json column that would mean the JSON value
        // `null` rather than SQL NULL.
        redTeamConfig: Prisma.DbNull,
      });
    });
  });

  describe("given a strategy with no objective", () => {
    /** @scenario A strategy with no objective is refused */
    it("is refused, because the run would quietly become a standard one", () => {
      // buildRedTeamAgent needs both; with only a strategy it returns null and
      // the run uses the cooperative simulator, passing with no attack made.
      const issue = redTeamStateIssue({ redTeamStrategy: "crescendo" });

      expect(issue?.field).toBe("redTeamTarget");
    });

    it("is refused when the objective is present but blank", () => {
      expect(
        redTeamStateIssue({ redTeamStrategy: "goat", redTeamTarget: "   " })
          ?.field,
      ).toBe("redTeamTarget");
    });
  });

  describe("given a complete attack", () => {
    it("raises nothing", () => {
      expect(
        redTeamStateIssue({
          redTeamStrategy: "crescendo",
          redTeamTarget: "extract the override code",
        }),
      ).toBeNull();
    });
  });

  describe("given an objective but no strategy", () => {
    it("raises nothing, since that is simply a standard scenario", () => {
      expect(
        redTeamStateIssue({ redTeamTarget: "extract the code" }),
      ).toBeNull();
    });
  });

  describe("given planner settings on GOAT, which ignores them", () => {
    /** @scenario Planner settings are refused on a strategy that ignores them */
    it("is refused rather than accepted and dropped", () => {
      const issue = redTeamStateIssue({
        redTeamStrategy: "goat",
        redTeamTarget: "extract the code",
        redTeamConfig: { attackPlan: "Turns 1-10: build rapport." },
      });

      expect(issue?.field).toBe("redTeamConfig");
    });

    it("is refused even when an earlier planner field is blank", () => {
      // `a ?? b` short-circuits on "" because empty is not nullish, so a blank
      // attack plan used to hide a planning prompt that was actually set.
      const issue = redTeamStateIssue({
        redTeamStrategy: "goat",
        redTeamTarget: "extract the code",
        redTeamConfig: {
          attackPlan: "",
          metapromptTemplate: "Plan the attack for {target}.",
        },
      });

      expect(issue?.field).toBe("redTeamConfig");
    });

    it("allows blank planner fields, which mean nothing was set", () => {
      expect(
        redTeamStateIssue({
          redTeamStrategy: "goat",
          redTeamTarget: "extract the code",
          redTeamConfig: { attackPlan: "", metapromptTemplate: "" },
        }),
      ).toBeNull();
    });

    it("accepts the same settings on Crescendo, which uses them", () => {
      expect(
        redTeamStateIssue({
          redTeamStrategy: "crescendo",
          redTeamTarget: "extract the code",
          redTeamConfig: { attackPlan: "Turns 1-10: build rapport." },
        }),
      ).toBeNull();
    });
  });

  describe("given a partial update merged over what is stored", () => {
    const stored = {
      redTeamStrategy: "crescendo",
      redTeamTarget: "extract the override code",
      redTeamTotalTurns: 30,
      redTeamConfig: null,
    };

    it("keeps fields the request never mentioned", () => {
      const merged = mergeRedTeamState({ redTeamTotalTurns: 12 }, stored);

      expect(merged.redTeamTarget).toBe("extract the override code");
      expect(merged.redTeamTotalTurns).toBe(12);
    });

    /** @scenario A strategy with no objective is refused */
    it("treats an explicit null as a clear, so the pairing check sees it", () => {
      // Caught live: `??` merged the stored objective back in, the check
      // passed, and the null was written anyway — the strategy was left with
      // nothing to act on, which is the downgrade the check exists to stop.
      const merged = mergeRedTeamState({ redTeamTarget: null }, stored);

      expect(merged.redTeamTarget).toBeNull();
      expect(redTeamStateIssue(merged)?.field).toBe("redTeamTarget");
    });

    it("allows clearing the whole attack at once", () => {
      const merged = mergeRedTeamState(
        { redTeamStrategy: null, redTeamTarget: null },
        stored,
      );

      expect(redTeamStateIssue(merged)).toBeNull();
    });
  });

  describe("given a write that does not mention the attack", () => {
    it("is recognised, so the stored row need not be read to check it", () => {
      expect(touchesRedTeam({})).toBe(false);
      expect(touchesRedTeam({ redTeamTotalTurns: 12 })).toBe(true);
      // An explicit clear still counts as mentioning it.
      expect(touchesRedTeam({ redTeamStrategy: null })).toBe(true);
    });
  });

  describe("given a write that clears only the strategy", () => {
    /** @scenario Clearing the attack turns the scenario back into a standard one */
    it("clears the rest of the attack with it", () => {
      // The editor and `--standard` both send all four. Over raw REST this
      // used to validate and leave the objective, the budget and the stored
      // config behind — so re-enabling red team months later resurrected an
      // objective and an attack plan nobody had chosen, and picking GOAT then
      // 400d on a planner setting the user never set.
      expect(normalizeRedTeamWrite({ redTeamStrategy: null })).toEqual({
        redTeamStrategy: null,
        redTeamTarget: null,
        redTeamTotalTurns: null,
        redTeamConfig: null,
      });
    });

    it("leaves a field the same request set explicitly", () => {
      expect(
        normalizeRedTeamWrite({
          redTeamStrategy: null,
          redTeamTarget: "keep this on the row",
        }).redTeamTarget,
      ).toBe("keep this on the row");
    });

    it("leaves every other write untouched", () => {
      expect(normalizeRedTeamWrite({ redTeamTotalTurns: 12 })).toEqual({
        redTeamTotalTurns: 12,
      });
      expect(normalizeRedTeamWrite({ redTeamStrategy: "goat" })).toEqual({
        redTeamStrategy: "goat",
      });
      // Absent is not the same as null: a rename must not clear the attack.
      // Assigned first because callers pass a whole write body, not a literal
      // of red-team keys — that is the shape the guard has to hold for.
      const rename = { name: "Renamed" };
      expect(normalizeRedTeamWrite(rename)).toEqual({ name: "Renamed" });
    });
  });

  describe("given a draft carrying planner settings the strategy ignores", () => {
    /** @scenario Switching to a strategy that ignores the planner clears it */
    it("drops them on the way to the write", () => {
      const written = withApplicableRedTeamConfig({
        redTeamStrategy: "goat",
        redTeamTarget: "extract the code",
        redTeamConfig: {
          attackPlan: "Turns 1-10: build rapport.",
          metapromptTemplate: "Plan for {target}.",
          successScore: 8,
        },
      });

      expect(written.redTeamConfig).toEqual({ successScore: 8 });
      // Stripped, so the rule that refuses the pair has nothing to refuse.
      expect(redTeamStateIssue(written)).toBeNull();
    });

    it("keeps them for the strategy that reads them", () => {
      const config = { attackPlan: "Turns 1-10: build rapport." };

      expect(
        withApplicableRedTeamConfig({
          redTeamStrategy: "crescendo",
          redTeamTarget: "extract the code",
          redTeamConfig: config,
        }).redTeamConfig,
      ).toEqual(config);
    });

    it("leaves everything else on the write untouched", () => {
      const state = {
        redTeamStrategy: "goat",
        redTeamTarget: "extract the code",
        redTeamTotalTurns: 30,
        redTeamConfig: { successScore: 8 },
      };

      expect(withApplicableRedTeamConfig(state)).toEqual(state);
    });
  });

  describe("given free text far longer than anyone would type", () => {
    /**
     * Each of these is re-embedded into the attacker's prompt on every turn of
     * a run that can be fifty turns long, so an unbounded value is written
     * once and paid for fifty times.
     */
    /** @scenario Free-text attack settings are bounded */
    it("refuses an objective past the cap", () => {
      expect(
        schema.safeParse({
          redTeamTarget: "x".repeat(RED_TEAM_MAX_TARGET_LENGTH + 1),
        }).success,
      ).toBe(false);
      expect(
        schema.safeParse({
          redTeamTarget: "x".repeat(RED_TEAM_MAX_TARGET_LENGTH),
        }).success,
      ).toBe(true);
    });

    /** @scenario Free-text attack settings are bounded */
    it("refuses an attack plan and a planning prompt past the cap", () => {
      expect(
        schema.safeParse({
          redTeamConfig: {
            attackPlan: "x".repeat(RED_TEAM_MAX_PLAN_LENGTH + 1),
          },
        }).success,
      ).toBe(false);
      expect(
        schema.safeParse({
          redTeamConfig: {
            metapromptTemplate: "x".repeat(RED_TEAM_MAX_PLAN_LENGTH + 1),
          },
        }).success,
      ).toBe(false);
    });
  });

  describe("given an objective that is only whitespace", () => {
    /** @scenario An objective of only whitespace is refused */
    it("is rejected, since the planner would have nothing to aim at", () => {
      expect(schema.safeParse({ redTeamTarget: "   " }).success).toBe(false);
    });

    it("is trimmed when it does carry text", () => {
      const parsed = schema.parse({ redTeamTarget: "  extract the code  " });

      expect(parsed.redTeamTarget).toBe("extract the code");
    });
  });

  describe("given a turn count outside the allowed range", () => {
    it("is rejected rather than silently clamped", () => {
      expect(schema.safeParse({ redTeamTotalTurns: 0 }).success).toBe(false);
      expect(schema.safeParse({ redTeamTotalTurns: 999 }).success).toBe(false);
    });
  });
});
