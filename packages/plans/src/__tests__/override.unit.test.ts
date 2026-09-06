import { describe, expect, it } from "vitest";
import { planCatalogue } from "../catalogue.ts";
import { UNLIMITED } from "../limits.ts";
import { applyOverride } from "../override.ts";

const growth = planCatalogue.plan("GROWTH");
const enterprise = planCatalogue.plan("ENTERPRISE");

describe("given a bespoke contract over a plan", () => {
  describe("when it settles a member ceiling", () => {
    /** @scenario "An explicit value in the contract wins over the plan's tier" */
    it("carries the contract's ceiling", () => {
      const applied = applyOverride({
        deployment: "cloud",
        override: {
          provenance: "negotiated",
          limits: { members: { value: 42, unit: "members" } },
          gates: {},
        },
        plan: growth,
      });

      expect(applied.limits.members.value).toBe(42);
      expect(applied.limits.volume).toEqual(growth.limits.volume);
    });
  });

  describe("when it withholds a capability the tier grants", () => {
    /** @scenario "A gate the contract explicitly withholds stays withheld" */
    it("does not grant it", () => {
      const applied = applyOverride({
        deployment: "cloud",
        override: { provenance: "negotiated", limits: {}, gates: { auditLogs: false } },
        plan: enterprise,
      });

      expect(applied.gates.auditLogs).toBe(false);
      expect(applied.gates.scim).toBe(true);
    });
  });

  describe("when a self-hosted contract states less volume than the baseline", () => {
    /** @scenario "A self-hosted contract may not lower a plan beneath the open-source baseline" */
    it("floors the volume at the open-source baseline", () => {
      const applied = applyOverride({
        deployment: "self-hosted",
        override: {
          provenance: "licence",
          limits: { volume: { value: 1_000, unit: "messages-per-month" } },
          gates: { canPublish: false },
        },
        plan: enterprise,
      });

      expect(applied.limits.volume.value).toBe(UNLIMITED);
      expect(applied.gates.canPublish).toBe(true);
    });
  });

  describe("when a self-hosted contract sells ten seats", () => {
    /** @scenario "A self-hosted contract's seat count binds" */
    it("allows ten members and not more", () => {
      const applied = applyOverride({
        deployment: "self-hosted",
        override: {
          provenance: "licence",
          limits: { members: { value: 10, unit: "members" } },
          gates: {},
        },
        plan: enterprise,
      });

      expect(applied.limits.members.value).toBe(10);
    });
  });

  describe("when it is applied over a self-serve plan", () => {
    /** @scenario "An overridden plan is account-managed whatever it started as" */
    it("is account-managed", () => {
      expect(growth.accountManaged).toBe(false);

      const applied = applyOverride({
        deployment: "cloud",
        override: { provenance: "licence", limits: {}, gates: {} },
        plan: growth,
      });

      expect(applied.accountManaged).toBe(true);
    });
  });
});
