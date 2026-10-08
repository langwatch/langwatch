/**
 * ADR-175: the three rule shapes an aggregate project may store, and the one
 * it starts with. The form and the server share this schema.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { describe, expect, it } from "vitest";

import {
  AGGREGATE_DEFAULT_RULE,
  AGGREGATE_RULE_KINDS,
  aggregateRuleSchema,
} from "../aggregate-rule.ts";

describe("given the aggregate rule shapes", () => {
  it("names the three kinds the ADR fixes, and defaults to all personal projects", () => {
    expect(AGGREGATE_RULE_KINDS).toEqual(["all-personal", "personal-by-department", "explicit"]);
    expect(aggregateRuleSchema.parse(AGGREGATE_DEFAULT_RULE)).toEqual({ kind: "all-personal" });
  });

  it("refuses an explicit rule with no projects and a shape with stray fields", () => {
    expect(aggregateRuleSchema.validate({ kind: "explicit", projectIds: [] })).toBe(false);
    expect(aggregateRuleSchema.validate({ kind: "all-personal", where: "x" })).toBe(false);
  });
});
