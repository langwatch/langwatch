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
  mergeRedTeamState,
  redTeamFields,
  redTeamStateIssue,
  toPrismaRedTeamWrite,
} from "../red-team-input";

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
      expect(redTeamStateIssue({ redTeamTarget: "extract the code" })).toBeNull();
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
