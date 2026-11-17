// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Which subscription fact changes nurturing's plan copy: the newest billing fact wins, and a real
 * fact wins a tie (ADR-174 decision 17).
 * @see enterprise/modules/nurturing/specs/customer-io-plan-traits.feature
 */
import { describe, expect, it } from "vitest";

import {
  type NurturingPlanFact,
  planFactChangesCopy,
} from "../nurturing-organization-plan.rules.ts";

const real = (occurredAt: number, plan = "LAUNCH"): NurturingPlanFact => ({
  plan,
  occurredAt,
  fromCatchUp: false,
});
const catchUp = (occurredAt: number, plan = "LAUNCH"): NurturingPlanFact => ({
  plan,
  occurredAt,
  fromCatchUp: true,
});
const changes = (held: NurturingPlanFact | null, incoming: NurturingPlanFact) =>
  planFactChangesCopy({
    held: held ? { outcome: "held", fact: held } : { outcome: "none" },
    incoming,
  });

describe("planFactChangesCopy", () => {
  describe("when a fact folds into nurturing's plan copy", () => {
    /** @scenario "The plan copy keeps the newest fact, and a real fact wins a tie" */
    it("drops an older and a tied catch-up over a real fact, and takes a newer catch-up", () => {
      const held = real(20);

      expect(changes(held, catchUp(10))).toBe(false);
      expect(changes(held, catchUp(20))).toBe(false);
      expect(changes(held, catchUp(30, "GROWTH"))).toBe(true);
    });

    it("lands the first fact the copy sees", () => {
      expect(changes(null, catchUp(10))).toBe(true);
    });

    it("lets a newer fact of either kind replace the held one", () => {
      expect(changes(real(10), real(20, "GROWTH"))).toBe(true);
      expect(changes(catchUp(10), catchUp(20))).toBe(true);
      expect(changes(catchUp(10), real(20))).toBe(true);
      expect(changes(real(10), catchUp(20))).toBe(true);
    });

    it("drops an older fact of either kind, an older real one against a newer catch-up too", () => {
      expect(changes(real(20), real(10))).toBe(false);
      expect(changes(catchUp(20), catchUp(10))).toBe(false);
      expect(changes(catchUp(20), real(10))).toBe(false);
      expect(changes(real(20), catchUp(10))).toBe(false);
    });

    it("gives a tie to a real fact over a held catch-up, never to a catch-up over a real one", () => {
      expect(changes(catchUp(10), real(10))).toBe(true);
      expect(changes(real(10), catchUp(10))).toBe(false);
    });

    it("keeps the held fact on a tie between two of the same kind", () => {
      expect(changes(real(10), real(10, "GROWTH"))).toBe(false);
      expect(changes(catchUp(10), catchUp(10, "GROWTH"))).toBe(false);
    });
  });
});
