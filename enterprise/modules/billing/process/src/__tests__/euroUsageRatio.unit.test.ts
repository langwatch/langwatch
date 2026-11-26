/**
 * The PII picker quotes euros at the ratio billing prices the euro line at; the two live in
 * different modules, so this holds them together.
 * @see enterprise/modules/billing/specs/euro-usage-prices.feature
 */

import { PII_REDACTION_EUR_PER_USD } from "@langwatch/data-privacy-contract/pii-redaction-spend";
import { GROWTH_USAGE_EUR_PER_USD } from "@langwatch/enterprise-billing-contract";
import { describe, expect, it } from "vitest";

describe("the euro usage ratio", () => {
  /** @scenario "A mapped euro usage price costs 0.85 of its dollar price" */
  it("is the same in billing's catalogue check and the PII picker's quote", () => {
    expect(GROWTH_USAGE_EUR_PER_USD).toBe(0.85);
    expect(PII_REDACTION_EUR_PER_USD).toBe(GROWTH_USAGE_EUR_PER_USD);
  });
});
