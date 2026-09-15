import { describe, expect, it } from "vitest";
import { planCatalogue } from "../catalogue.ts";
import { PLAN_DISPUTE_IDS, PLAN_DISPUTES } from "../disputes.ts";
import { LIMIT_NAMES, LIMIT_UNITS } from "../limits.ts";
import { PLAN_TYPES } from "../plan-type.ts";
import { planSchema } from "../plan.ts";

const VOLUME_DISPUTED = new Set(
  PLAN_DISPUTES.filter((dispute) => dispute.field === "volume").flatMap(
    (dispute) => dispute.subjects,
  ),
);

describe("given the plan catalogue", () => {
  describe("when every plan is parsed against the schema", () => {
    /** @scenario "Every plan in the catalogue satisfies the plan schema" */
    it("accepts every plan", () => {
      const rejected = planCatalogue
        .all()
        .filter((plan) => !planSchema.safeParse(plan).success)
        .map((plan) => plan.type);

      expect(rejected).toEqual([]);
    });
  });

  describe("when a plan type is looked up", () => {
    /** @scenario "Every plan type resolves to a plan" */
    it("answers with the plan of that type for every type", () => {
      expect(PLAN_TYPES.map((type) => planCatalogue.plan(type).type)).toEqual([...PLAN_TYPES]);
    });
  });

  describe("when a limit is read", () => {
    /** @scenario "Every limit carries the unit it is counted in" */
    it("names one of the catalogue's units", () => {
      const units = planCatalogue
        .all()
        .flatMap((plan) =>
          LIMIT_NAMES.map((name) => plan.limits[name]?.unit).filter(
            (unit): unit is string => unit !== undefined,
          ),
        );

      expect(units.every((unit) => (LIMIT_UNITS as readonly string[]).includes(unit))).toBe(true);
      expect(units.length).toBeGreaterThan(0);
    });
  });
});

describe("given the self-serve ladder", () => {
  describe("when the disputed rungs are set aside", () => {
    /** @scenario "The tiered ladder rises in volume once disputed rungs are set aside" */
    it("sells at least as much volume at each step up", () => {
      const baseline = planCatalogue.baseline("cloud");
      const sequence = [
        { type: baseline.type, volume: baseline.limits.volume.value },
        ...planCatalogue
          .rungs({ pricingModel: "TIERED" })
          .map((rung) => ({ type: rung.tier, volume: rung.volume.value })),
      ].filter((entry) => !VOLUME_DISPUTED.has(entry.type));

      const descending = sequence.filter(
        (entry, index) => index > 0 && entry.volume < (sequence[index - 1]?.volume ?? 0),
      );

      expect(descending).toEqual([]);
      expect(sequence.length).toBeGreaterThan(1);
    });
  });

  describe("when an annual variant is placed", () => {
    /** @scenario "An annual variant shares the rung of the plan it is the same plan as" */
    it("answers with the monthly plan's rung", () => {
      const rung = planCatalogue.rungOf({ pricingModel: "TIERED", type: "LAUNCH_ANNUAL" });

      expect(rung?.tier).toBe("LAUNCH");
      expect(rung?.types).toContain("LAUNCH");
    });
  });

  describe("when the rung above a plan is asked for", () => {
    /** @scenario "The rung above a plan is the next one up by volume" */
    it("answers with the next rung up", () => {
      expect(planCatalogue.above({ pricingModel: "TIERED", type: "LAUNCH" })?.tier).toBe("GROWTH");
      expect(planCatalogue.above({ pricingModel: "TIERED", type: "GROWTH" })).toBeUndefined();
    });
  });

  describe("when the plan is one a person sells", () => {
    /** @scenario "An account-managed plan sits on no rung" */
    it("has no rung on either ladder", () => {
      expect(planCatalogue.isAccountManaged("ENTERPRISE")).toBe(true);
      expect(planCatalogue.isAccountManaged("OPEN_SOURCE")).toBe(true);

      const managed = planCatalogue.all().filter((plan) => plan.accountManaged);
      expect(managed.map((plan) => plan.selfServe)).toEqual(managed.map(() => null));
    });
  });
});

describe("given the disputes the catalogue records", () => {
  describe("when they are listed", () => {
    /** @scenario "The catalogue lists exactly the disputes found in the census" */
    it("lists exactly the four the census found", () => {
      const listed = planCatalogue.disputes().map((dispute) => dispute.id);

      expect(listed.sort()).toEqual([
        "automation-ceiling-three-ways",
        "free-plan-two-definitions",
        "growth-copy-volume",
        "pro-volume-below-free",
      ]);
      expect(PLAN_DISPUTE_IDS.length).toBe(4);
    });
  });

  describe("when a dispute names the plans it lands on", () => {
    /** @scenario "Every dispute names the plans it lands on, and those plans name it back" */
    it("agrees with what those plans record", () => {
      const fromDisputes = PLAN_DISPUTES.flatMap((dispute) =>
        dispute.subjects.map((subject) => `${dispute.id}|${subject}`),
      ).sort();
      const fromPlans = planCatalogue
        .all()
        .flatMap((plan) => plan.disputed.map((id) => `${id}|${plan.type}`))
        .sort();

      expect(fromPlans).toEqual(fromDisputes);
    });
  });

  describe("when a dispute is read", () => {
    /** @scenario "Each dispute records both the chosen value and the one it disagrees with" */
    it("names the site of the value in force and of every alternative", () => {
      for (const dispute of PLAN_DISPUTES) {
        expect(dispute.chosen.source).toMatch(/^[\w./@-]+:\d+$/);
        expect(dispute.alternatives.length).toBeGreaterThan(0);
        for (const alternative of dispute.alternatives) {
          expect(alternative.source).toMatch(/^[\w./@-]+:\d+$/);
        }
      }
    });
  });
});
