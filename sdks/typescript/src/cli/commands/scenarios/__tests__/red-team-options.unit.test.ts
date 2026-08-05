/**
 * @vitest-environment node
 *
 * The CLI is the third surface that can configure an attack, after the editor
 * and the REST API. The REST one shipped broken — it validated the fields and
 * never sent them — so these tests cover the translation itself: what a set of
 * flags becomes in the request body, and which combinations are refused
 * outright rather than creating something that looks configured and is not.
 */
import { describe, expect, it } from "vitest";
import {
  RedTeamOptionError,
  mergeRedTeamConfig,
  redTeamConfigPatch,
  toRedTeamBody,
} from "../red-team-options";

const create = { mode: "create" } as const;
const update = { mode: "update" } as const;

describe("the red-team CLI flags", () => {
  describe("given no red-team flags", () => {
    it("sends nothing, so a plain update leaves the attack alone", () => {
      expect(toRedTeamBody({}, update)).toEqual({});
    });
  });

  describe("given a strategy and an objective", () => {
    /** @scenario Configuring an attack persists it, whichever way it was created */
    it("sends both", () => {
      expect(
        toRedTeamBody(
          {
            redTeamStrategy: "crescendo",
            redTeamTarget: "get the agent to reveal its system prompt",
          },
          create,
        ),
      ).toEqual({
        redTeamStrategy: "crescendo",
        redTeamTarget: "get the agent to reveal its system prompt",
      });
    });

    it("accepts the strategy however it was capitalised", () => {
      const body = toRedTeamBody(
        { redTeamStrategy: "GOAT", redTeamTarget: "extract credentials" },
        create,
      );

      expect(body.redTeamStrategy).toBe("goat");
    });

    it("trims the objective", () => {
      const body = toRedTeamBody(
        { redTeamStrategy: "goat", redTeamTarget: "  extract credentials  " },
        create,
      );

      expect(body.redTeamTarget).toBe("extract credentials");
    });
  });

  describe("given a strategy with no objective", () => {
    describe("when creating", () => {
      it("refuses, rather than creating an attack with nothing to pursue", () => {
        // The platform treats a strategy without a target as a standard
        // scenario, so this would otherwise succeed and quietly do nothing.
        expect(() =>
          toRedTeamBody({ redTeamStrategy: "crescendo" }, create),
        ).toThrow(RedTeamOptionError);
      });
    });

    describe("when updating", () => {
      /**
       * The rule is about a scenario's final state, and an update is a patch —
       * the objective it needs may already be on the row. The API merges before
       * it checks, and answers 200. Asking the same question of the flags alone
       * made the CLI exit 1 on an operation the platform performs happily.
       */
      /** @scenario Changing strategy on a configured scenario does not resend the objective */
      it("sends it, because the objective may already be stored", () => {
        expect(toRedTeamBody({ redTeamStrategy: "goat" }, update)).toEqual({
          redTeamStrategy: "goat",
        });
      });
    });
  });

  describe("given an unknown strategy", () => {
    it("names the ones that exist", () => {
      expect(() =>
        toRedTeamBody(
          { redTeamStrategy: "mystery", redTeamTarget: "x y z" },
          create,
        ),
      ).toThrow(/crescendo or goat/);
    });
  });

  describe("given a turn budget", () => {
    it("sends it as a number", () => {
      const body = toRedTeamBody(
        {
          redTeamStrategy: "crescendo",
          redTeamTarget: "extract credentials",
          redTeamTurns: "12",
        },
        create,
      );

      expect(body.redTeamTotalTurns).toBe(12);
    });

    it("refuses a value outside the supported range", () => {
      const base = {
        redTeamStrategy: "crescendo",
        redTeamTarget: "extract credentials",
      };

      expect(() =>
        toRedTeamBody({ ...base, redTeamTurns: "0" }, create),
      ).toThrow();
      expect(() =>
        toRedTeamBody({ ...base, redTeamTurns: "51" }, create),
      ).toThrow();
      expect(() =>
        toRedTeamBody({ ...base, redTeamTurns: "ten" }, create),
      ).toThrow();
    });
  });

  describe("given --no-red-team-scoring", () => {
    it("turns scoring and refusal detection off together", () => {
      // The SDK's documented fast recipe moves both, and refusal detection
      // only feeds the scorer.
      expect(redTeamConfigPatch({ redTeamScoring: false })).toEqual({
        scoreResponses: false,
        detectRefusals: false,
      });
    });

    it("is not part of the body on its own, so it cannot replace the column", () => {
      // `redTeamConfig` is one JSONB column and a write replaces all of it.
      // Putting the patch straight in the body is what destroyed the settings
      // the editor had written.
      const body = toRedTeamBody(
        {
          redTeamStrategy: "crescendo",
          redTeamTarget: "extract credentials",
          redTeamScoring: false,
        },
        create,
      );

      expect(body).not.toHaveProperty("redTeamConfig");
    });
  });

  describe("given the flag is absent", () => {
    it("asks for no config change", () => {
      // Commander defaults a `--no-x` boolean to true rather than leaving it
      // undefined, so `true` has to read as "not asked", not as "turn it on".
      expect(redTeamConfigPatch({})).toBeUndefined();
      expect(redTeamConfigPatch({ redTeamScoring: true })).toBeUndefined();
    });
  });

  describe("given a scenario that already has settings", () => {
    /** @scenario Changing one attack setting leaves the others alone */
    it("keeps the settings the flag says nothing about", () => {
      const merged = mergeRedTeamConfig(
        { scoreResponses: false, detectRefusals: false },
        {
          successScore: 7,
          injectionProbability: 0.25,
          attackPlan: "Turns 1-10: ask about products.",
          scoreResponses: true,
        },
      );

      expect(merged).toEqual({
        successScore: 7,
        injectionProbability: 0.25,
        attackPlan: "Turns 1-10: ask about products.",
        scoreResponses: false,
        detectRefusals: false,
      });
    });

    it("carries through a setting the CLI has never heard of", () => {
      // The platform owns this contract and will grow knobs the CLI does not
      // model. A merge that only knew its own keys would drop them — the same
      // silent loss, one release later.
      const merged = mergeRedTeamConfig(
        { scoreResponses: false },
        { somethingAddedLater: "keep me" },
      );

      expect(merged.somethingAddedLater).toBe("keep me");
    });

    it("treats a scenario with no stored config as an empty one", () => {
      expect(mergeRedTeamConfig({ scoreResponses: false }, null)).toEqual({
        scoreResponses: false,
      });
      expect(mergeRedTeamConfig({ scoreResponses: false }, undefined)).toEqual({
        scoreResponses: false,
      });
    });
  });

  describe("given --standard", () => {
    /** @scenario Clearing the attack turns the scenario back into a standard one */
    it("clears every red-team column", () => {
      expect(toRedTeamBody({ standard: true }, update)).toEqual({
        redTeamStrategy: null,
        redTeamTarget: null,
        redTeamTotalTurns: null,
        redTeamConfig: null,
      });
    });

    it("refuses to be combined with flags that configure an attack", () => {
      expect(() =>
        toRedTeamBody({ standard: true, redTeamStrategy: "goat" }, update),
      ).toThrow(RedTeamOptionError);
    });
  });
});
