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
import { RedTeamOptionError, toRedTeamBody } from "../red-team-options";

describe("the red-team CLI flags", () => {
  describe("given no red-team flags", () => {
    it("sends nothing, so a plain update leaves the attack alone", () => {
      expect(toRedTeamBody({})).toEqual({});
    });
  });

  describe("given a strategy and an objective", () => {
    it("sends both", () => {
      expect(
        toRedTeamBody({
          redTeamStrategy: "crescendo",
          redTeamTarget: "get the agent to reveal its system prompt",
        }),
      ).toEqual({
        redTeamStrategy: "crescendo",
        redTeamTarget: "get the agent to reveal its system prompt",
      });
    });

    it("accepts the strategy however it was capitalised", () => {
      const body = toRedTeamBody({
        redTeamStrategy: "GOAT",
        redTeamTarget: "extract credentials",
      });

      expect(body.redTeamStrategy).toBe("goat");
    });

    it("trims the objective", () => {
      const body = toRedTeamBody({
        redTeamStrategy: "goat",
        redTeamTarget: "  extract credentials  ",
      });

      expect(body.redTeamTarget).toBe("extract credentials");
    });
  });

  describe("given a strategy with no objective", () => {
    it("refuses, rather than creating an attack with nothing to pursue", () => {
      // The platform treats a strategy without a target as a standard
      // scenario, so this would otherwise succeed and quietly do nothing.
      expect(() => toRedTeamBody({ redTeamStrategy: "crescendo" })).toThrow(
        RedTeamOptionError,
      );
    });
  });

  describe("given an unknown strategy", () => {
    it("names the ones that exist", () => {
      expect(() =>
        toRedTeamBody({ redTeamStrategy: "mystery", redTeamTarget: "x y z" }),
      ).toThrow(/crescendo or goat/);
    });
  });

  describe("given a turn budget", () => {
    it("sends it as a number", () => {
      const body = toRedTeamBody({
        redTeamStrategy: "crescendo",
        redTeamTarget: "extract credentials",
        redTeamTurns: "12",
      });

      expect(body.redTeamTotalTurns).toBe(12);
    });

    it("refuses a value outside the supported range", () => {
      const base = {
        redTeamStrategy: "crescendo",
        redTeamTarget: "extract credentials",
      };

      expect(() => toRedTeamBody({ ...base, redTeamTurns: "0" })).toThrow();
      expect(() => toRedTeamBody({ ...base, redTeamTurns: "51" })).toThrow();
      expect(() => toRedTeamBody({ ...base, redTeamTurns: "ten" })).toThrow();
    });
  });

  describe("given --no-red-team-scoring", () => {
    it("turns scoring and refusal detection off together", () => {
      // The SDK's documented fast recipe moves both, and refusal detection
      // only feeds the scorer.
      const body = toRedTeamBody({
        redTeamStrategy: "crescendo",
        redTeamTarget: "extract credentials",
        redTeamScoring: false,
      });

      expect(body.redTeamConfig).toEqual({
        scoreResponses: false,
        detectRefusals: false,
      });
    });
  });

  describe("given --standard", () => {
    it("clears every red-team column", () => {
      expect(toRedTeamBody({ standard: true })).toEqual({
        redTeamStrategy: null,
        redTeamTarget: null,
        redTeamTotalTurns: null,
        redTeamConfig: null,
      });
    });

    it("refuses to be combined with flags that configure an attack", () => {
      expect(() =>
        toRedTeamBody({ standard: true, redTeamStrategy: "goat" }),
      ).toThrow(RedTeamOptionError);
    });
  });
});
