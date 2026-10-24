import { describe, expect, it } from "vitest";

import {
  authorizationConditionSchema,
  BRAID_CONDITION_COMPILER_VERSION,
  grantConditionSchema,
} from "../index";

/**
 * ADR-185 §3: a braid's condition read in its compiled form, one release before braids write it.
 * @see specs/rbac/authz-grants.feature
 */

const COMPILED = {
  version: BRAID_CONDITION_COMPILER_VERSION,
  tree: { kind: "nameEquals", value: "payments_agent" },
};
const WHERE = 'name == "payments_agent"';

describe("a braid's condition", () => {
  describe("when the ledger's stored window carries a compiled where", () => {
    /** @scenario "A braid's attach is read before braids are written" */
    it("keeps the compiled form rather than dropping it", () => {
      const parsed = grantConditionSchema.parse({
        type: "span",
        where: WHERE,
        compiledWhere: COMPILED,
        from: "2026-10-01T00:00:00.000Z",
      });

      expect(parsed.compiledWhere).toEqual(COMPILED);
    });

    it("refuses a compiled form outside the compiler's tree", () => {
      const compiledWhere = { version: 1, tree: { kind: "nameEquals", value: "" } };

      expect(grantConditionSchema.validate({ type: "span", compiledWhere })).toBe(false);
    });
  });

  describe("when a proof's window is a span with a where", () => {
    it("accepts it with its compiled form", () => {
      const condition = {
        type: "span",
        where: WHERE,
        compiledWhere: COMPILED,
        from: 0,
        until: null,
      };

      expect(authorizationConditionSchema.validate(condition)).toBe(true);
    });

    /** @scenario "A braid's where is refused without its compiled form" */
    it("refuses it without its compiled form", () => {
      const condition = { type: "span", where: WHERE, from: 0, until: null };

      expect(authorizationConditionSchema.validate(condition)).toBe(false);
    });
  });

  describe("when a window other than a span carries a compiled where", () => {
    it("refuses it, since no fence would apply it", () => {
      const condition = { type: "trace", compiledWhere: COMPILED, from: 0, until: null };

      expect(authorizationConditionSchema.validate(condition)).toBe(false);
    });
  });
});
