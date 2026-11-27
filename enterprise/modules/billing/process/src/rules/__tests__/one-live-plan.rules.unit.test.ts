// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The one-live-plan index's migration leaves out exactly the tiered plans billing names.
 * @see ../../../../specs/billing.feature
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { TIERED_PLAN_TYPES } from "@langwatch/enterprise-billing-contract";
import { describe, expect, it } from "vitest";

const MIGRATION = fileURLToPath(
  new URL(
    "../../../../../../../packages/prisma-client/prisma/migrations/20261127180500_subscription_one_live_stripe_plan/migration.sql",
    import.meta.url,
  ),
);

/** Every `"plan" NOT IN (...)` list in the statements, comments left out, doubled quotes read. */
function excludedPlanLists(sql: string): string[][] {
  const statements = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  return [...statements.matchAll(/"plan" NOT IN \(([^)]*)\)/g)].map(([, list = ""]) =>
    [...list.matchAll(/'+([A-Z_]+)'+/g)].map(([, plan = ""]) => plan),
  );
}

describe("the one-live-plan index migration", () => {
  /** @scenario "The database refuses a second live Stripe-backed plan for an organization" */
  it("leaves out the tiered plans, in the duplicate search and in the index it builds", () => {
    const lists = excludedPlanLists(readFileSync(MIGRATION, "utf8"));

    expect(lists).toHaveLength(2);
    for (const list of lists) {
      expect(new Set(list)).toEqual(new Set(TIERED_PLAN_TYPES));
      expect(list).toHaveLength(TIERED_PLAN_TYPES.length);
    }
  });
});
