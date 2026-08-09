/**
 * Route documentation is part of the contract: the fixed 13-month window and
 * the downstream dedup guidance are load-bearing for reconciliation
 * consumers, so they live here as constants a unit test pins. Dependency-free
 * on purpose (the unit test must import without booting the server stack).
 */
export const SPEND_EVENTS_PULL_DESCRIPTION =
  "Cursor-paged pull over the per-request spend record, ascending by insert order so rows folded late are never skipped by an in-flight cursor. Events are the same canonical objects webhook deliveries carry. Retention is a fixed 13 months, which bounds reconciliation and replay. When feeding a downstream biller, mind its dedup window (Metronome 34 days, Stripe meters 24h+): re-pulling older ranges into a biller past its window can double-bill.";

export const END_USER_SPEND_DESCRIPTION =
  "Windowed spend rollup for one external end user across the organization (the /customer/info-style read a rebilling integration polls). `caps` lists every attributed-user budget that applies to this end user, each with its limit and the spend against it. It is an empty array until such a budget template applies, never null.";
