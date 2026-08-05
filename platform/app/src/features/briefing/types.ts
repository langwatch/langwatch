/**
 * The shape of Langy's home briefing (spec: specs/home/langy-briefing.feature).
 *
 * These are the PRESENTATION types — what the briefing renders. The container
 * (`useLangyBriefing`) derives them from the project's real signals; where a
 * signal has no source, the container omits that section rather than inventing
 * one. Nothing here carries fake data — every section is optional so the card
 * renders only what the project actually has.
 */

/** A single plan chip (e.g. "32 scenarios · DE / FR / NL"). */
export interface BriefingPill {
  label: string;
}

/** One scenario line: a labelled pass/regression bar with a status word. */
export interface ScenarioBar {
  id: string;
  label: string;
  /** Drives the bar colour and the status word. */
  status: "pass" | "regression" | "fail";
  /** 0–100; how full the bar reads (a pass is near-full, a fail runs red). */
  fillPct: number;
  /** The word at the end of the row ("pass", "regression"). */
  statLabel: string;
}

/** JudgeAgent's tally for the run. */
export interface JudgeSummary {
  pass: number;
  regressions: number;
  /** A short trust line ("rubric audited · signed"), if any. */
  note?: string;
}

/** How much a case needs the reader: drives the receipt's status dot. */
export type BriefingSeverity = "error" | "attention" | "steady";

/** A trend read-out next to a receipt (a cost, a latency, a count). */
export interface BriefingMetric {
  text: string;
  tone: "down" | "up" | "ok";
}

/**
 * Search evidence a receipt can hand to Langy. The query is the same Trace
 * Explorer query the receipt's "Open traces" action uses, so attaching the
 * receipt never turns a concrete signal into vague prose.
 */
export interface BriefingReceiptContext {
  id: string;
  label: string;
  query: string;
  meta?: Record<string, string | number | boolean>;
}

/**
 * One evidence-backed item in the attention inbox — a changed/repeated error
 * shape, a shared signal across errored traces, or a meaningful latency
 * regression. The link points at the exact Trace Explorer search behind the
 * claim, so the row is a starting point rather than a report.
 */
export interface BriefingReceipt {
  id: string;
  severity: BriefingSeverity;
  /** A short mono subject rendered inline (e.g. "longest trace"). */
  subject?: string;
  detail: string;
  metric?: BriefingMetric;
  link?: { label: string; href: string };
  /** Concrete trace-filter evidence that can be attached to Langy's next turn. */
  context?: BriefingReceiptContext;
  /**
   * A scoped question for this signal. Reserved: the row no longer renders its
   * own "Ask Langy" button (the row opens traces, the paperclip attaches, and
   * asking is the card-level ⌘I) — kept so a future one-click "investigate this"
   * can seed the composer without re-plumbing the derivation.
   */
  askPrompt?: string;
}

/** A prompt revision Langy drafted from a regression, ready to review. */
export interface BriefingDraftedPr {
  title: string;
  /** Sub-line meta, already composed ("4 failing scenarios attached"). */
  meta: string;
  added?: number;
  removed?: number;
  href: string;
}

export interface BriefingData {
  /** The window this reads over, in words: "since yesterday", "last 24 hours". */
  since: string;
  /** The loop read-out on the right of the header ("median PM to PR 14 min"). */
  loop?: string;
  /** The one-line plain-language read that leads the card. */
  headline: string;
  /**
   * The project has NOTHING to read yet (no traces, no scenarios, no recent
   * work). The sheet leads with the typed invitation (QuietHeadline) instead
   * of a plain headline: first steps typed and deleted in rotation, each
   * openable (docs / feature page) or handable to Langy.
   */
  quiet?: boolean;
  /** A caption above the receipts ("Needs a look"). */
  receiptsLabel?: string;
  /** Specific cases that need attention — errors, slow / expensive, outliers. */
  receipts?: BriefingReceipt[];
  /** Plan chips for the most relevant recent run. */
  pills?: BriefingPill[];
  /** A caption above the scenario bars ("Last run · 32 concurrent"). */
  scenariosLabel?: string;
  bars?: ScenarioBar[];
  /** The tail line under the bars ("28 more · faithfulness dropped 0.91 to 0.62"). */
  barsMore?: string;
  judge?: JudgeSummary;
  draftedPr?: BriefingDraftedPr;
  /** An example question to seed the composer ("why did DE start failing?"). */
  askHint?: string;
  /**
   * Ready-to-ask questions derived from the project's own data, rendered as
   * one-click chips in the sheet's footer — each opens Langy with the
   * question already sent.
   */
  suggestions?: string[];
  /** Where "open session" points (the Langy run / conversation). */
  sessionHref?: string;
}

/** A single figure in the status strip. */
export interface StatusCell {
  label: string;
  /** The value, pre-formatted (mono, tabular). */
  value: string;
  /**
   * Whether it needs the reader. `bad` / `good` colour the value and light a
   * dot; `neutral` is a plain status; `vanity` is a table-stakes metric,
   * demoted to the tail of the strip.
   */
  tone: "good" | "bad" | "neutral" | "vanity";
  /** Period-over-period change vs the previous window, pre-formatted ("+12%"). */
  delta?: string;
  /**
   * How the change reads: latency/cost creeping UP is "bad" (amber), coming
   * DOWN is "good"; volume shifts (traces, users, tokens) stay "neutral".
   */
  deltaTone?: "good" | "bad" | "neutral";
  link?: string;
}
