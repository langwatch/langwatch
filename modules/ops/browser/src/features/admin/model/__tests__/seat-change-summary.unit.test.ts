/** @see specs/self-hosting/connected-services/license-registry.feature */
import { describe, expect, it } from "vitest";

import { seatChangeSummary } from "../seat-change-summary.ts";

const changed = ({
  from,
  to,
  billing,
}: {
  from: number;
  to: number;
  billing: "pending" | "nothing_to_invoice";
}) => ({ previousMaxMembers: from, license: { maxMembers: to }, billing });

describe("what the operator reads after changing seats", () => {
  it("says billing invoices the added seats of a linked license", () => {
    expect(seatChangeSummary(changed({ from: 50, to: 58, billing: "pending" }))).toContain(
      "Billing invoices the added seats, prorated to the end of the term; the Billing section shows the outcome.",
    );
  });

  /** @scenario "Seats raised on a license linked to no customer leave billing nothing to invoice" */
  it("says nothing is invoiced for a license linked to no customer", () => {
    expect(
      seatChangeSummary(changed({ from: 50, to: 58, billing: "nothing_to_invoice" })),
    ).toContain("Nothing is invoiced: the license is linked to no customer.");
  });

  it("says seats that went down are not credited", () => {
    expect(seatChangeSummary(changed({ from: 50, to: 40, billing: "nothing_to_invoice" }))).toBe(
      "Seats lowered from 50 to 40. The install picks the new license up on its next sync or when an admin presses refresh. Seats that went down are not credited.",
    );
  });
});
