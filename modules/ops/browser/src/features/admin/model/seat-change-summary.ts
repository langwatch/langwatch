/** The part of a seat change's answer the summary reads, as main's section typed it. */
type ChangedSeats = {
  previousMaxMembers: number;
  license: { maxMembers: number };
  billing: "pending" | "nothing_to_invoice";
};

/** What the operator reads once the seats changed, in main's words. */
export function seatChangeSummary(result: ChangedSeats): string {
  const raised = result.license.maxMembers > result.previousMaxMembers;
  const moved = raised
    ? `raised from ${result.previousMaxMembers} to ${result.license.maxMembers}`
    : `lowered from ${result.previousMaxMembers} to ${result.license.maxMembers}`;
  return `Seats ${moved}. The install picks the new license up on its next sync or when an admin presses refresh. ${billingOutcome({ raised, billing: result.billing })}`;
}

function billingOutcome({
  raised,
  billing,
}: {
  raised: boolean;
  billing: ChangedSeats["billing"];
}): string {
  if (billing === "pending") {
    return "Billing invoices the added seats, prorated to the end of the term; the Billing section shows the outcome.";
  }
  if (raised) return "Nothing is invoiced: the license is linked to no customer.";
  return "Seats that went down are not credited.";
}
