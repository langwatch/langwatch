/**
 * The widgets of the boards preloaded for one agent kind read what their prototype cards
 * read: string-level checks of each stored widget's code and named queries.
 */

import { describe, expect, it } from "vitest";

import { implementedWidget } from "../index.ts";
import { FIELD_CHECK, REPEAT_CHECK, UNIT_KEYS } from "../widgets/agent-kind-queries.ts";

function built(id: string) {
  const widget = implementedWidget(id);
  if (!widget) throw new Error(`${id} has no build`);
  const sql = Object.fromEntries(widget.definition.queries.map(({ name, sql }) => [name, sql]));
  return { code: widget.definition.code, sql, layout: widget.layout };
}

const UNIT_WIDGETS = ["att-share", "att-table", "att-change", "cost-by-segment"];

describe("given the By customer widgets", () => {
  /** @scenario "AC80 By customer: the board groups by the first key the traces carry" */
  it("picks the first grouping key any trace carries, in the seed's order", () => {
    expect(UNIT_KEYS.map(({ attribute }) => attribute)).toEqual([
      "langwatch.customer_id",
      "metadata.document_type",
      "metadata.language",
      "metadata.team",
      "metadata.flow",
      "metadata.segment",
      "metadata.topic",
      "langwatch.labels",
    ]);
    for (const id of UNIT_WIDGETS) {
      const { sql } = built(id);
      const grouped = Object.values(sql).filter((text) => text.includes("AS unit_key"));
      expect(grouped.length, id).toBeGreaterThan(0);
      for (const text of grouped) {
        expect(text, id).toContain("multiIf(");
        expect(text, id).toContain("JSONExtractString(Attributes['langwatch.labels'], 1)");
      }
    }
  });

  /** @scenario "AC80 By customer: the board groups by the first key the traces carry" */
  it("names the unit by its key and counts traces without it on their own row", () => {
    const { code } = built("att-share");
    expect(code).toContain('"metadata.document_type":{"one":"document type"');
    expect(code).toContain('if (!value) return "No " + unitOf(key).one;');
  });

  /** @scenario "AC80b By customer: no grouping key says what to send" */
  it("says no trace carries a grouping key when the chosen key is empty", () => {
    for (const id of ["att-share", "att-table", "cost-by-segment"]) {
      expect(built(id).code, id).toContain(
        "if (!key) return <Panel><Note>{NO_UNIT}</Note></Panel>;",
      );
    }
  });

  /** @scenario "AC81 By customer: conversations by customer with each one's share" */
  it("ranks six customers by conversations, with their share and the count of the rest", () => {
    const { code, sql } = built("att-share");
    expect(sql.units).toContain("uniqExact(if(Attributes['langwatch.thread.id'] != ''");
    expect(sql.units).toContain("ORDER BY conversations DESC");
    expect(sql.totals).toContain("AS units");
    expect(code).toContain("units.data.slice(0, 6)");
    expect(code).toContain("pct(row.value / total, 0)");
  });

  /** @scenario "AC82 By customer: one row per customer with pass rate, the period before and AI cost" */
  it("reads verdicts at the judged answer's time and flags a drop beyond chance", () => {
    const { code, sql } = built("att-table");
    expect(sql.passRates).toContain("countIf(t.at < {dashboard_context_period_start:DateTime})");
    expect(sql.passRates).toContain("e.IsGuardrail = false");
    expect(code).toContain("const MIN_JUDGED = 30;");
    expect(code).toContain("drop >= 0.02 && spread > 0 && drop / spread >= 1.96");
    for (const header of ["Pass rate", "Before", "AI cost"]) {
      expect(code).toContain(`header: "${header}"`);
    }
  });

  /** @scenario "AC83 By customer: pass rate on the newest prompt version against the one before" */
  it("compares each customer's pass rate on the newest version with the one before", () => {
    const { code, sql } = built("att-change");
    expect(sql.change).toContain("arrayReverseSort(groupArray(tuple(first_seen, version)))");
    expect(sql.change).toContain("length(versions) > 1");
    expect(sql.units).toContain("GROUP BY unit, version");
    expect(code).toContain('row.version === last.version ? "after"');
    expect(code).toContain("No new prompt version started in this period.");
  });

  /** @scenario "AC84 By customer: spend by customer, top six" */
  it("ranks the six costliest customers and sums the rest", () => {
    const { code, sql } = built("cost-by-segment");
    expect(sql.units).toContain("ORDER BY cost DESC\nLIMIT 6");
    expect(code).toContain("and {more} more {unitOf(key).many}, {usd(rest)}");
  });
});

describe("given the Call quality widgets", () => {
  /** @scenario "AC85 Call quality: reply time by stage" */
  it("sums each reply's stage spans and compares the halves of the period", () => {
    const { code, sql } = built("voice-turn-latency");
    expect(sql.summary).toContain("HAVING countIf(SpanName IN ('stt', 'tts')) > 0");
    expect(sql.summary).toContain(
      "sumIf(DurationMs, SpanAttributes['langwatch.span.type'] = 'llm')",
    );
    expect(sql.summary).toContain("speaking_second_p95");
    expect(code).toContain('label="Reply time, slowest 5%"');
    expect(code).toContain('label="Grew most, second half"');
  });

  /** @scenario "AC86 Call quality: calls not ended and repeated sentences" */
  it("counts calls ending on an error and calls the repeat check failed, per 1,000", () => {
    const { code, sql } = built("voice-call-health");
    expect(sql.summary).toContain("argMax(ContainsErrorStatus, OccurredAt) AS not_ended");
    expect(sql.summary).toContain(`EvaluatorName = '${REPEAT_CHECK}'`);
    expect(sql.summary).toContain("AS repeat_checks");
    expect(code).toContain('"Add the " + REPEAT_CHECK');
  });
});

describe("given the Field accuracy widgets", () => {
  /** @scenario "AC87 Field accuracy: accuracy per field and document type" */
  it("splits the field check's wrong list per field and document type", () => {
    const { code, sql } = built("ext-field-accuracy");
    expect(sql.wrong).toContain(`e.EvaluatorName = '${FIELD_CHECK}'`);
    expect(sql.wrong).toContain("arrayJoin(splitByString(', '");
    expect(code).toContain("const FLOOR = 0.9;");
    expect(code).toContain("const MIN_CHECKED = 30;");
  });

  /** @scenario "AC88 Field accuracy: share sent to human review" */
  it("reads sent_to_review or a hand-over outcome and names the type sent most", () => {
    const { code, sql } = built("ext-human-review");
    expect(sql.summary).toContain("Attributes['metadata.sent_to_review'] = 'true'");
    expect(sql.summary).toContain("Attributes['metadata.outcome'] = 'handover'");
    expect(sql.byUnit).toContain("ORDER BY documents >= 30 DESC");
    expect(code).toContain("reports sent_to_review or an outcome");
  });
});

describe("given the Outputs users keep widget", () => {
  /** @scenario "AC89 Outputs users keep: drop-off after generation" */
  it("counts outputs by reported action and names the biggest drop", () => {
    const { code, sql } = built("gen-dropoff");
    expect(sql.main).toContain("Attributes['metadata.output_action'] IN ('accepted', 'edited')");
    expect(code).toContain('"biggest drop, at "');
  });
});

describe("given the Risk sign-off widgets", () => {
  /** @scenario "AC90 Risk sign-off: sign-off status" */
  it("reads guardrail coverage, flagged answers and the review backlog", () => {
    const { code, sql } = built("so-verdict");
    expect(sql.guardrails).toContain("Label = 'flagged'");
    expect(sql.guardrails).toContain("IsGuardrail = true");
    expect(sql.backlog).toContain("FROM annotation_queue_items");
    expect(code).toContain('"Ready to sign."');
  });

  /** @scenario "AC91 Risk sign-off: policy checks with their margin" */
  it("lists judges, lowest pass rate first, with a Wilson margin against 90%", () => {
    const { code, sql } = built("so-rubric");
    expect(sql.main).toContain("IsGuardrail = false");
    expect(sql.main).toContain("ORDER BY passed / judged ASC");
    expect(code).toContain("const FLOOR = 0.9;");
    expect(code).toContain("function margin(passed, judged)");
  });

  /** @scenario "AC92 Risk sign-off: review queue" */
  it("reads annotation queue items in, reviewed, pending and the typical wait", () => {
    const { code, sql } = built("so-queue");
    expect(sql.summary).toContain("AS wait_seconds");
    expect(sql.flow).toContain("UNION ALL");
    expect(code).toContain('label="Typical wait"');
  });

  /** @scenario "AC93 Risk sign-off: change log" */
  it("lists prompt versions, new evaluators and changed online evaluations, newest first", () => {
    const { sql } = built("so-changes");
    for (const view of ["prompt_versions", "evaluators", "monitors"]) {
      expect(sql.main).toContain(`FROM ${view}`);
    }
    expect(sql.main).toContain("ORDER BY at DESC");
  });
});
