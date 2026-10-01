// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { ConnectedBillingOverview } from "@langwatch/enterprise-billing-contract";

type SeatChange = ConnectedBillingOverview["seatChanges"][number];

/** How often the Billing section rereads while a seat change is not settled yet. */
export const UNSETTLED_SEAT_CHANGE_POLL_MS = 5_000;

/** A change billing has not decided yet, or one still waiting for the payment provider. */
export function isSeatChangeUnsettled(change: SeatChange): boolean {
  return change.state === "awaiting" || change.state === "intent";
}

export function hasUnsettledSeatChange(overview: ConnectedBillingOverview | undefined): boolean {
  return overview?.seatChanges.some(isSeatChangeUnsettled) ?? false;
}

/** The badge one seat change carries, in main's words where main had them. */
export function seatChangeBadge(change: SeatChange): string {
  switch (change.state) {
    case "awaiting":
      return "Seat change recorded";
    case "intent":
      return "Seat invoice pending";
    case "invoiced":
      return "Seats invoiced";
    case "not_onboarded":
      return "Invoice by hand";
    case "nothing_to_invoice":
      return "Nothing invoiced";
  }
}

/** What finance reads about one seat change. */
export function seatChangeOutcome(change: SeatChange): string {
  switch (change.state) {
    case "awaiting":
      return "Billing invoices the added seats within a minute.";
    case "intent":
      return "Still waiting for the payment provider. The next billing pass retries it.";
    case "invoiced":
      return "The added seats were invoiced, prorated to the end of the term.";
    case "not_onboarded":
      return "No billing account yet, so finance invoices the added seats by hand.";
    case "nothing_to_invoice":
      return "Nothing was invoiced: the term has no days left to charge for.";
  }
}
