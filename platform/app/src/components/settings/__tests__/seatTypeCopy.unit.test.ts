/**
 * See specs/licensing/seat-type-explained.feature.
 *
 * The seat copy is a billing promise, so it is pinned to the permission set it
 * describes. If `EXTERNAL_MEMBER_PERMISSIONS` gains or loses a resource, the
 * sentence an admin reads before paying for a seat has to move with it.
 */

import { describe, expect, it } from "vitest";
import { EXTERNAL_MEMBER_PERMISSIONS } from "../../../server/api/rbac";
import { LITE_MEMBER_EXPLANATION, LITE_MEMBER_SHORT_DESCRIPTION } from "../seatTypeCopy";

/** The resources the explanation promises a lite member can read. */
const NAMED_IN_COPY: Record<string, string> = {
  traces: "traces",
  analytics: "analytics",
  evaluations: "evaluations",
  scenarios: "scenario runs",
  datasets: "datasets",
  prompts: "prompts",
  experiments: "experiments",
};

describe("lite member seat copy", () => {
  describe("when an admin reads it before choosing a seat type", () => {
    /** @scenario The explanation names capability rather than a billing switch */
    it("describes a lite member by what they can do", () => {
      expect(LITE_MEMBER_SHORT_DESCRIPTION).toMatch(/view/i);
      expect(LITE_MEMBER_SHORT_DESCRIPTION).toMatch(/not change/i);
    });

    /** @scenario The explanation names capability rather than a billing switch */
    it("never presents the choice as a billing setting", () => {
      expect(LITE_MEMBER_EXPLANATION).not.toMatch(/billing|invoice|seat count/i);
      expect(LITE_MEMBER_SHORT_DESCRIPTION).not.toMatch(/billing|invoice/i);
    });

    it("says a lite member cannot see costs", () => {
      expect(LITE_MEMBER_EXPLANATION).toMatch(/cannot see costs/i);
    });

    it("says permission to change something makes the seat full", () => {
      expect(LITE_MEMBER_EXPLANATION).toMatch(/full seat/i);
    });

    it("says the limits hold through the API and MCP, not just the app", () => {
      expect(LITE_MEMBER_EXPLANATION).toMatch(/API/);
      expect(LITE_MEMBER_EXPLANATION).toMatch(/MCP/);
    });
  });

  describe("when the underlying permission set is the source of truth", () => {
    it("names every resource a lite member can read", () => {
      const readable = EXTERNAL_MEMBER_PERMISSIONS.filter((permission) =>
        permission.endsWith(":view"),
      ).map((permission) => permission.split(":")[0]!);

      const missing = Object.entries(NAMED_IN_COPY)
        .filter(([resource]) => readable.includes(resource))
        .filter(([, phrase]) => !LITE_MEMBER_EXPLANATION.includes(phrase))
        .map(([resource]) => resource);

      expect(missing).toEqual([]);
    });

    it("promises annotations as the one thing a lite member can change", () => {
      const writable = EXTERNAL_MEMBER_PERMISSIONS.filter(
        (permission) => !permission.endsWith(":view"),
      ).map((permission) => permission.split(":")[0]!);

      expect(new Set(writable)).toEqual(new Set(["annotations"]));
      expect(LITE_MEMBER_EXPLANATION).toMatch(/annotations/i);
    });

    it("does not promise a resource the permission set withholds", () => {
      const readable = EXTERNAL_MEMBER_PERMISSIONS.map(
        (permission) => permission.split(":")[0]!,
      );

      const overpromised = Object.entries(NAMED_IN_COPY)
        .filter(([, phrase]) => LITE_MEMBER_EXPLANATION.includes(phrase))
        .filter(([resource]) => !readable.includes(resource))
        .map(([resource]) => resource);

      expect(overpromised).toEqual([]);
      expect(readable).not.toContain("cost");
    });
  });
});
