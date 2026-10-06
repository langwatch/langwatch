/**
 * The Answer quality and What users ask widgets read what their cards promise: the app's
 * outcome before the judge's, reviewer thumbs for agreement, empty searches from retrieval
 * spans, and topic shares against the period before.
 */

import { describe, expect, it } from "vitest";

import { CATALOGUE_WIDGET_BUILDS } from "../index.ts";
import { OUTCOME_JUDGE } from "../widgets/answers-asks-queries.ts";

const buildOf = (id: string) => {
  const build = CATALOGUE_WIDGET_BUILDS[id];
  if (!build) throw new Error(`no build for ${id}`);
  return { tsx: build.code.tsx, source: build.code.source, sql: build.queries };
};

describe("given the Answer quality widgets", () => {
  /** @scenario "AC40 Answer quality: How conversations ended reads the app's outcome first, then the judge" */
  it("takes the app's outcome before the outcome judge's label, and compares reasons", () => {
    const { sql, tsx } = buildOf("ans-outcomes");
    expect(OUTCOME_JUDGE).toBe("Conversation Outcome Judge");
    expect(sql.trend).toContain(
      "if(t.Attributes['metadata.outcome'] != '', t.Attributes['metadata.outcome'], ifNull(j.label, ''))",
    );
    expect(sql.trend).toContain(`EvaluatorName = '${OUTCOME_JUDGE}'`);
    for (const outcome of ["misunderstood", "capability_gap", "refusal", "handover"]) {
      expect(sql.trend).toContain(`countIf(outcome = '${outcome}') AS ${outcome}`);
    }
    expect(sql.reasons).toContain("countIf(at < {dashboard_context_period_start:DateTime})");
    expect(sql.reasons).toContain("LIMIT 5");
    expect(tsx).toContain("Top reasons");
  });

  /** @scenario "AC41 Answer quality: Unanswered, by topic is the refused share of closed conversations per topic" */
  it("ranks topics by their refused share and charts the overall share", () => {
    const { sql, tsx } = buildOf("ans-idk");
    expect(sql.topics).toContain("countIf(outcome = 'refusal') AS refused");
    expect(sql.topics).toContain("ORDER BY refused / closed DESC");
    expect(sql.trend).toContain("AS bucket");
    expect(tsx).toContain('<Stat label="All conversations"');
  });

  /** @scenario "AC42 Answer quality: Judges vs reviewers scores agreement per week from reviewer thumbs" */
  it("pairs verdicts with reviewer thumbs per week and falls back to the annotations setup", () => {
    const { sql, tsx, source } = buildOf("so-agreement");
    expect(sql.weekly).toContain("FROM annotations");
    expect(sql.weekly).toContain("ON a.TraceId = e.TraceId");
    expect(sql.weekly).toContain("toMonday(e.OccurredAt)");
    expect(sql.weekly).toContain("(agreement - chance) / (1 - chance) AS kappa");
    expect(tsx).toContain("target: 0.8");
    expect(source).toBe("feedback");
    expect(tsx).toContain('LW.navigate("annotations"');
  });

  /** @scenario "AC43 Answer quality: To review lists failed checks from the last 3 days with one random audit" */
  it("lists four failed traces of the last 3 days with reasons, plus one passed at random", () => {
    const { sql, tsx } = buildOf("ans-review");
    expect(sql.flagged).toContain("subtractDays({dashboard_context_period_end:DateTime}, 3)");
    expect(sql.flagged).toContain("Passed = 0");
    expect(sql.flagged).toContain("argMax(Details, ScheduledAt) AS reason");
    expect(sql.flagged).toContain("LIMIT 4");
    expect(sql.audit).toContain("HAVING min(Passed) = 1");
    expect(sql.audit).toContain("LIMIT 1");
    expect(tsx).toContain("Picked at random to check the judges");
  });

  /** @scenario "AC44 Answer quality: Retrieval or generation splits failed searches by cause" */
  it("gives each failed search one cause, an empty search first", () => {
    const { sql } = buildOf("rag-failure-source");
    expect(sql.trend).toContain("JSONLength(SpanAttributes['langwatch.rag.contexts']) = 0");
    expect(sql.trend).toContain(
      "countIf(s.found_nothing = 1 AND (s.errored = 1 OR ifNull(j.failed, 0) = 1)) AS retrieval",
    );
    expect(sql.trend).toContain("countIf(s.found_nothing = 0 AND s.errored = 1) AS errors");
    expect(sql.trend).toContain(
      "countIf(s.found_nothing = 0 AND s.errored = 0 AND ifNull(j.failed, 0) = 1) AS generation",
    );
  });

  /** @scenario "AC45 Answer quality: Empty retrieval rate counts questions whose search returned nothing" */
  it("divides empty searches by searches per bucket", () => {
    const { sql, tsx } = buildOf("rag-empty-retrieval");
    expect(sql.trend).toContain("SpanAttributes['langwatch.span.type'] = 'rag'");
    expect(sql.trend).toContain("countIf(found_nothing = 1) AS empty_searches");
    expect(tsx).toContain("num(row.empty_searches) / num(row.questions)");
  });
});

describe("given the What users ask widgets", () => {
  /** @scenario "AC46 What users ask: Requests it cannot serve counts capability gaps per topic" */
  it("counts capability gaps per topic with the most common reason", () => {
    const { sql } = buildOf("ask-cannot");
    expect(sql.topics).toContain("WHERE outcome = 'capability_gap'");
    expect(sql.topics).toContain("topK(1)(reason)[1] AS reason");
    expect(sql.topics).toContain("nullIf(t.Attributes['metadata.topic'], '')");
  });

  /** @scenario "AC47 What users ask: Rising and new topics compares topic shares with the period before" */
  it("compares topic shares with the equally long period before and marks new topics", () => {
    const { sql, tsx } = buildOf("ask-rising");
    expect(sql.shares).toContain(
      "countIf(t.OccurredAt < {dashboard_context_period_start:DateTime})",
    );
    expect(sql.shares).toContain("subtractSeconds({dashboard_context_period_start:DateTime}");
    expect(tsx).toContain("num(row.in_previous) === 0 && num(row.in_period) > 0");
    expect(tsx).toContain("No topics in the period before to compare with");
  });

  /** @scenario "AC48 What users ask: Topics people ask about shows volume, success and cannot-do per topic" */
  it("shows traces, resolved share and capability gaps, with checks when nothing is judged", () => {
    const { sql, tsx } = buildOf("ans-topics");
    expect(sql.topics).toContain("countIf(c.outcome = 'resolved') AS resolved");
    expect(sql.topics).toContain("countIf(c.outcome = 'capability_gap') AS cannot");
    expect(sql.topics).toContain("AND IsGuardrail = 0");
    expect(tsx).toContain('byOutcome ? "Resolved" : "Checks passed"');
  });

  /** @scenario "AC49 What users ask: Asked again shows misread conversations and returning users" */
  it("charts the misread share and the people who came back", () => {
    const { sql, tsx } = buildOf("ask-again");
    expect(sql.trend).toContain("countIf(outcome = 'misunderstood') AS misunderstood");
    expect(sql.users).toContain("countIf(in_period > 0 AND in_previous > 0) AS returning");
    expect(tsx).toContain("Came back");
  });
});
