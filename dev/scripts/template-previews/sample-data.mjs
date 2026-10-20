/**
 * PREVIEW ONLY. Sample answers for every query the captured templates run, keyed by
 * `widget/query`: one fictional online-shop support agent over the 30 days to the fixed clock, so
 * every widget on a card tells the same story. Never seeded or shipped; capture.mjs reads it.
 */

/** The clock every capture runs at; the board's 30-day window ends here. */
export const PREVIEW_NOW = "2026-09-24T12:00:00.000Z";

const DAY_MS = 86_400_000;
const FIRST_DAY = Date.UTC(2026, 7, 25);
const stamp = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

/** The window's day buckets as ClickHouse sends them; the last one is half a day. */
export const DAYS = Array.from({ length: 31 }, (_, i) => stamp(FIRST_DAY + i * DAY_MS));

// The story: an outage on day 19 of the window (errors and latency spike), then a release on
// day 23 (support-agent v14) that lifts answer quality and trims cost.
const INCIDENT = 18;
const RELEASE = 22;
const LAST = DAYS.length - 1;
const HALF = 15;
const MONDAYS = DAYS.map((_, i) => i).filter(
  (i) => new Date(FIRST_DAY + i * DAY_MS).getUTCDay() === 1,
);
const MONTH_START = DAYS.findIndex((day) => day.endsWith("-01 00:00:00"));

// A fixed wobble in -0.5..0.5 per day and series, so every run draws the same lines.
const wobble = (i, seed) => {
  const x = Math.sin((i + 1) * 12.9898 + seed * 78.233) * 43_758.5453;
  return x - Math.floor(x) - 0.5;
};
const round = (value, digits = 0) => Number(value.toFixed(digits));
const sum = (values) => values.reduce((total, value) => total + value, 0);
const days = (from = 0, to = LAST) => DAYS.map((_, i) => i).filter((i) => i >= from && i <= to);
const isWeekend = (i) => [0, 6].includes(new Date(FIRST_DAY + i * DAY_MS).getUTCDay());
const isAfterRelease = (i) => i >= RELEASE;
/** The share of calls that dropped: worst on the incident day, lower after the release. */
const droppedShare = (i) => {
  if (i === INCIDENT) return 0.09;
  return isAfterRelease(i) ? 0.022 : 0.036;
};
const at = (i, time = "09:14:00") => `${DAYS[i].slice(0, 10)} ${time}`;
const daily = (row) => DAYS.map((bucket, i) => ({ bucket, ...row(i) }));
const PRESENT = [{ present: 1 }];

const conversations = (i) =>
  Math.round(
    430 *
      (isWeekend(i) ? 0.72 : 1) *
      (1 + 0.004 * i) *
      (1 + 0.1 * wobble(i, 1)) *
      (i === LAST ? 0.5 : 1),
  );
const traces = (i) => Math.round(conversations(i) * 1.36);
const resolvedRate = (i) =>
  (isAfterRelease(i) ? 0.86 : 0.79) + 0.03 * wobble(i, 2) - (i === INCIDENT ? 0.09 : 0);
const errorRate = (i) => (i === INCIDENT ? 0.094 : 0.021 + 0.01 * wobble(i, 3));
const p95 = (i) => (i === INCIDENT ? 5_420 : Math.round(2_180 + 320 * wobble(i, 4)));
const costPerConversation = (i) => (isAfterRelease(i) ? 0.031 : 0.036) + 0.003 * wobble(i, 5);
const checkPassRate = (i) =>
  (isAfterRelease(i) ? 0.952 : 0.914) + 0.012 * wobble(i, 6) - (i === INCIDENT ? 0.05 : 0);
const cost = (i) => conversations(i) * costPerConversation(i);
const closedShare = 0.64;

const total = (series, range = days()) => sum(range.map(series));
const CONVERSATIONS = total(conversations);
const TRACES = total(traces);
const COST = total(cost);
const CLOSED = Math.round(CONVERSATIONS * closedShare);
const RESOLVED = Math.round(total((i) => conversations(i) * closedShare * resolvedRate(i)));
const CHECKS = Math.round(TRACES * 0.7);
const CHECKS_PASSED = Math.round(total((i) => traces(i) * 0.7 * checkPassRate(i)));
const ERRORS = Math.round(total((i) => traces(i) * errorRate(i)));
const PREVIOUS = 0.91;

const TOPICS = [
  ["Order status", 0.24],
  ["Refunds", 0.17],
  ["Shipping times", 0.14],
  ["Returns", 0.12],
  ["Account access", 0.1],
  ["Discount codes", 0.09],
  ["Product questions", 0.08],
  ["Cancellations", 0.06],
];
const CUSTOMERS = [
  ["Halden Outdoor", 0.22],
  ["Brightline Books", 0.17],
  ["Corvo Coffee", 0.14],
  ["Mossgate Home", 0.12],
  ["Pellwood Kids", 0.1],
  ["Tidewell Pets", 0.09],
  ["Quarry Lane", 0.08],
  ["Fernhill Garden", 0.08],
];
const MODELS = [
  ["gpt-5-mini", 0.58, 1_640],
  ["claude-sonnet-4.5", 0.31, 2_480],
  ["gpt-5", 0.11, 3_120],
];
const traceId = (n) => `trace_7f3a${(n * 7919).toString(16).padStart(6, "0")}`;

const outcomes = (scale = 1) => ({
  closed: Math.round(CLOSED * scale),
  resolved: Math.round(RESOLVED * scale),
  closed_prev: Math.round(CLOSED * scale * PREVIOUS),
  resolved_prev: Math.round(CLOSED * scale * PREVIOUS * 0.78),
});
const spend = {
  conversations: CONVERSATIONS,
  conversations_prev: Math.round(CONVERSATIONS * PREVIOUS),
  cost: round(COST, 2),
  cost_prev: round(COST * 0.97, 2),
};
const checks = {
  passed: CHECKS_PASSED,
  judged: CHECKS,
  passed_prev: Math.round(CHECKS * PREVIOUS * 0.9),
  judged_prev: Math.round(CHECKS * PREVIOUS),
};
const percentiles = { p50_ms: 1_060, p90_ms: 1_840, p95_ms: 2_310, p99_ms: 3_960 };
const releaseChange = [
  { bucket: DAYS[RELEASE], at: at(RELEASE, "10:42:00"), label: "support-agent v14" },
];
const promptChange = [{ kind: "prompt", name: "support-agent v14", bucket: DAYS[RELEASE] }];

const units = (key, base = CONVERSATIONS) =>
  CUSTOMERS.map(([unit, share], n) => ({
    unit_key: key,
    unit,
    conversations: Math.round(base * share),
    cost: round(COST * share * (1 + 0.25 * wobble(n, 7)), 2),
  }));
const unitTotals = { conversations: CONVERSATIONS, units: CUSTOMERS.length, cost: round(COST, 2) };

// Topic shares now and in the period before: gift cards are new, refunds and codes are rising.
const TOPIC_SHIFT = [
  ["Order status", 0.22, 0.25],
  ["Refunds", 0.19, 0.15],
  ["Shipping times", 0.14, 0.13],
  ["Returns", 0.11, 0.12],
  ["Account access", 0.09, 0.11],
  ["Discount codes", 0.1, 0.08],
  ["Product questions", 0.07, 0.09],
  ["Cancellations", 0.05, 0.07],
  ["Gift cards", 0.03, 0],
];
const topicRows = (row) => TOPICS.map(([topic, share], n) => ({ topic, ...row({ share, n }) }));

/** By scenario index: the two scenarios the new release fails runs of. The others pass all 6. */
const NEW_PASSED = { 1: 3, 4: 5 };
const SCENARIOS = [
  ["sc-refund-limit", "Refund over the limit"],
  ["sc-late-parcel", "Late parcel, upset customer"],
  ["sc-wrong-item", "Wrong item delivered"],
  ["sc-address", "Change the delivery address"],
  ["sc-cancel", "Cancel after dispatch"],
  ["sc-human", "Asks for a person"],
  ["sc-code", "Expired discount code"],
  ["sc-injection", "Instructions hidden in an order note"],
];
const BATCHES = [
  ["batch-29", 29, 46, 44],
  ["batch-26", 26, 46, 41],
  ["batch-23", 23, 46, 42],
  ["batch-19", 19, 46, 37],
  ["batch-15", 15, 46, 39],
];

/** Every widget query's answer, by `widget/query`. */
export const SAMPLES = {
  // Agent health: one glance.
  "ck-kpis/present": PRESENT,
  "ck-kpis/outcomes": [outcomes()],
  "ck-kpis/spend": [spend],
  "ck-kpis/checks": [checks],
  "ck-status/present": PRESENT,
  "ck-status/main": [
    {
      requests: TRACES,
      requests_prev: Math.round(TRACES * PREVIOUS),
      errors: ERRORS,
      errors_prev: Math.round(ERRORS * 1.2),
      p95_ms: percentiles.p95_ms,
      p95_ms_prev: 2_470,
      cost: round(COST, 2),
      cost_prev: round(COST * 0.97, 2),
    },
  ],
  "ck-attention/present": PRESENT,
  "ck-attention/segments": [
    ...topicRows(({ share, n }) => {
      const size = Math.round(CHECKS * share);
      return {
        kind: "topic",
        pass: Math.round(size * (n === 1 ? 0.84 : 0.94)),
        n: size,
        base_pass: Math.round(size * 0.9 * 0.93),
        base_n: Math.round(size * 0.9),
      };
    }).map(({ topic, ...row }) => ({ segment: topic, ...row })),
    ...CUSTOMERS.map(([segment, share], n) => {
      const size = Math.round(CHECKS * share);
      return {
        segment,
        kind: "customer",
        pass: Math.round(size * (n === 2 ? 0.86 : 0.94)),
        n: size,
        base_pass: Math.round(size * 0.9 * 0.93),
        base_n: Math.round(size * 0.9),
      };
    }),
  ],
  "ck-attention/reasons": [
    { reason: "resolved", outcome: "resolved", now: RESOLVED, before: Math.round(RESOLVED * 0.88) },
    { reason: "Refund to a gift card", outcome: "capability_gap", now: 212, before: 96 },
    { reason: "Asked for a person", outcome: "handover", now: 184, before: 171 },
    { reason: "Read the wrong order", outcome: "misunderstood", now: 141, before: 158 },
    { reason: "Change a placed order", outcome: "capability_gap", now: 118, before: 104 },
    { reason: "Out of scope request", outcome: "refusal", now: 64, before: 70 },
  ],
  "ck-attention/agreement": [
    { evaluator: "Answer quality", audited: 220, agree: 196, judge_pass: 181, reviewer_pass: 173 },
    {
      evaluator: "Policy compliance",
      audited: 140,
      agree: 133,
      judge_pass: 129,
      reviewer_pass: 127,
    },
  ],
  "ck-attention/step": [{ step: "lookup_order", calls: 9_840, errors: 412, recovered: 371 }],
  "ck-top-ask/present": PRESENT,
  "ck-top-ask/seen": PRESENT,
  "ck-top-ask/gap": [
    {
      topic: "Refunds",
      gaps: 212,
      closed: 2_310,
      example: "Can I get the refund on a gift card?",
      trace_id: traceId(1),
    },
    {
      topic: "Order status",
      gaps: 96,
      closed: 3_340,
      example: "Where is the second half of my split order?",
      trace_id: traceId(2),
    },
    {
      topic: "Shipping times",
      gaps: 71,
      closed: 1_910,
      example: "Do you charge customs fees to Norway?",
      trace_id: traceId(3),
    },
  ],
  "ck-trend/present": PRESENT,
  "ck-trend/seen": PRESENT,
  "ck-trend/trend": daily((i) => {
    const closed = Math.round(conversations(i) * closedShare);
    return { resolved: Math.round(closed * resolvedRate(i)), closed };
  }),
  "ck-trend/changes": promptChange,
  "voice-task-success/present": PRESENT,
  "voice-task-success/seen": PRESENT,
  "voice-task-success/trend": [
    ["English", 0.7],
    ["Spanish", 0.2],
    ["German", 0.1],
  ].flatMap(([language, share]) =>
    daily((i) => {
      const calls = Math.round(conversations(i) * 0.3 * share);
      return { language, done: Math.round(calls * resolvedRate(i)), calls };
    }),
  ),
  "gen-acceptance/present": PRESENT,
  "gen-acceptance/seen": PRESENT,
  "gen-acceptance/actions": [
    ["accepted", 0.62],
    ["edited", 0.27],
    ["discarded", 0.11],
  ].flatMap(([action, share]) =>
    daily((i) => ({
      action,
      outputs: Math.round(
        conversations(i) * 0.5 * share * (isAfterRelease(i) && action === "accepted" ? 1.1 : 1),
      ),
    })),
  ),

  // Running costs.
  "cost-verdict/present": PRESENT,
  "cost-verdict/outcomes": [outcomes()],
  "cost-verdict/spend": [spend],
  "cost-verdict/month": [
    {
      month_to_date: round(total(cost, days(MONTH_START)), 2),
      last_7_days: round(total(cost, days(LAST - 6)), 2),
      days_with_data: LAST - MONTH_START + 1,
      day_of_month: LAST - MONTH_START + 1,
      days_in_month: 30,
    },
  ],
  "cost-by-source/present": PRESENT,
  "cost-by-source/main": [
    ["production", 1, 0],
    ["evaluations", 0.11, 0],
    ["simulations", 0.05, 0],
  ].flatMap(([source, share]) =>
    daily((i) => ({
      source,
      cost: round(cost(i) * share * (source === "simulations" && i % 3 !== 0 ? 0.2 : 1), 4),
      traces: Math.round(traces(i) * share),
      unpriced: 0,
    })),
  ),
  "cost-by-model/present": PRESENT,
  "cost-by-model/models": MODELS.map(([model, share]) => ({ model, cost: round(COST * share, 2) })),
  "cost-by-model/spend": [{ cost: round(COST, 2) }],
  "cost-waste/present": PRESENT,
  "cost-waste/main": [
    {
      spend: round(COST, 2),
      failed_traces: ERRORS,
      failed_cost: round(ERRORS * 0.041, 2),
      loop_traces: 236,
      loop_cost: round(236 * 0.118, 2),
      retry_traces: 612,
      retry_cost: round(612 * 0.012, 2),
    },
  ],
  "voice-cost-per-call/present": PRESENT,
  "voice-cost-per-call/total": [{ cost: round(COST, 2), calls: CONVERSATIONS }],
  "voice-cost-per-call/trend": daily((i) => ({ cost: round(cost(i), 4), calls: conversations(i) })),
  "ext-cost-per-doc/present": PRESENT,
  "ext-cost-per-doc/changes": promptChange,
  "ext-cost-per-doc/halves": [
    {
      first_cost: round(total(cost, days(0, HALF - 1)), 2),
      first_documents: total(conversations, days(0, HALF - 1)),
      second_cost: round(total(cost, days(HALF)), 2),
      second_documents: total(conversations, days(HALF)),
    },
  ],
  "ext-cost-per-doc/trend": MODELS.slice(0, 2).flatMap(([model, share]) =>
    daily((i) => ({
      model,
      cost: round(cost(i) * share, 4),
      documents: Math.round(conversations(i) * share),
    })),
  ),

  // Release check and compare models.
  "ship-verdict/present": PRESENT,
  "ship-verdict/scenarios": SCENARIOS.map(([scenario, name], n) => ({
    scenario,
    name,
    new_passed: NEW_PASSED[n] ?? 6,
    new_runs: 6,
    current_passed: n === 1 ? 22 : 23,
    current_runs: 24,
  })),
  "ship-verdict/costs": [
    { is_new: 1, started_at: at(29, "07:30:00.000"), typical_ms: 14_200, cost_per_run: 0.084 },
    { is_new: 0, started_at: at(15, "07:30:00.000"), typical_ms: 15_900, cost_per_run: 0.097 },
  ],
  "ship-suites/present": PRESENT,
  "ship-suites/summary": [{ passed: 412, runs: 448 }],
  "ship-suites/suites": [
    { suite: "Refunds", passed: 118, runs: 126 },
    { suite: "Order tracking", passed: 104, runs: 108 },
    { suite: "Escalation", passed: 77, runs: 90 },
    { suite: "Account", passed: 66, runs: 68 },
    { suite: "Safety", passed: 47, runs: 56 },
  ],
  "ship-flaky/present": PRESENT,
  "ship-flaky/main": SCENARIOS.map(([scenario, name], n) => {
    const strip = [
      "1101110111",
      "1110111011",
      "1111110111",
      "1111111101",
      "1111111111",
      "1011111111",
      "1111111111",
      "1111111111",
    ][n];
    return {
      scenario,
      name,
      strip,
      passed: strip.split("").filter((run) => run === "1").length,
      runs: strip.length,
    };
  }),
  "ship-compare/present": PRESENT,
  "ship-compare/main": BATCHES.map(([batch, day, scenarios, passed]) => ({
    batch,
    started_at: at(day, "07:30:00.000"),
    scenarios,
    passed,
    met: passed * 4 + 3,
    criteria: scenarios * 4,
    typical_ms: day >= RELEASE ? 14_200 : 15_900,
    cost_per_scenario: day >= RELEASE ? 0.084 : 0.097,
  })),
  "ship-models/present": PRESENT,
  "ship-models/main": [
    {
      setup: "claude-sonnet-4.5",
      pass_rate: 0.94,
      graded: 240,
      cost_per_row: 0.0182,
      p95_ms: 2_480,
    },
    { setup: "gpt-5", pass_rate: 0.93, graded: 240, cost_per_row: 0.0264, p95_ms: 3_120 },
    { setup: "gpt-5-mini", pass_rate: 0.89, graded: 240, cost_per_row: 0.0041, p95_ms: 1_640 },
  ],
  "ship-rollout/present": PRESENT,
  "ship-rollout/changes": releaseChange,
  "ship-rollout/checks": [
    {
      before_rate: 0.914,
      after_rate: 0.952,
      after_even_rate: 0.948,
      before_checks: 9_620,
      after_checks: 4_180,
    },
  ],
  "ship-rollout/traffic": [
    {
      after: 0,
      traces: total(traces, days(RELEASE - 7, RELEASE - 1)),
      error_rate: 0.026,
      p95_ms: 2_390,
      cost_per_trace: 0.0266,
    },
    {
      after: 1,
      traces: total(traces, days(RELEASE)),
      error_rate: 0.019,
      p95_ms: 2_210,
      cost_per_trace: 0.0228,
    },
  ],
  "rag-dataset-versions/present": PRESENT,
  "rag-dataset-versions/main": [
    ["run-v4", 28, 0.91, 0.89, 320],
    ["run-v3", 21, 0.86, 0.84, 320],
    ["run-v2", 13, 0.83, 0.8, 300],
    ["run-v1", 5, 0.79, 0.75, 280],
  ].map(([run_id, day, pass_rate, weighted_rate, judged]) => ({
    run_id,
    started_at: at(day, "08:00:00.000"),
    pass_rate,
    weighted_rate,
    judged,
  })),
  "ext-precision-recall/present": PRESENT,
  "ext-precision-recall/main": [29, 25, 21, 17, 13, 9, 5, 1].map((day, n) => ({
    run_id: `run-${day}`,
    started_at: at(day, "08:00:00.000"),
    precision_score: round(0.95 - n * 0.006 + 0.004 * wobble(n, 8), 3),
    recall_score: round(0.91 - n * 0.009 + 0.006 * wobble(n, 9), 3),
    documents: 200,
  })),

  // What users ask, answer quality, what it cannot answer.
  "ask-cannot/present": PRESENT,
  "ask-cannot/totals": [{ closed: CLOSED, cannot: 412 }],
  "ask-cannot/topics": [
    { topic: "Refunds", requests: 141, reason: "Refund to a gift card" },
    { topic: "Order status", requests: 96, reason: "Split orders have no tracking" },
    { topic: "Shipping times", requests: 71, reason: "Customs fees outside the EU" },
    { topic: "Returns", requests: 58, reason: "Return a bundle item alone" },
    { topic: "Account access", requests: 46, reason: "Merge two accounts" },
  ],
  "ask-rising/present": PRESENT,
  "ask-rising/daily": TOPIC_SHIFT.flatMap(([topic, now, was], n) =>
    daily((i) => ({
      topic,
      traces: Math.round(
        conversations(i) * (was + (now - was) * (i / LAST) * 1.6 + 0.004 * wobble(i, 20 + n)),
      ),
    })),
  ).filter(({ traces: count }) => count > 0),
  "ask-rising/shares": TOPIC_SHIFT.map(([topic, now, was]) => ({
    topic,
    in_period: Math.round(CONVERSATIONS * now),
    in_previous: Math.round(CONVERSATIONS * PREVIOUS * was),
  })),
  "ans-topics/topics": topicRows(({ share, n }) => {
    const requests = Math.round(CONVERSATIONS * share);
    const closed = Math.round(requests * closedShare);
    const run = Math.round(requests * 0.9);
    return {
      requests,
      closed,
      resolved: Math.round(closed * (n === 1 ? 0.71 : 0.86)),
      cannot: Math.round(closed * (n === 1 ? 0.09 : 0.03)),
      checks_passed: Math.round(run * (n === 1 ? 0.88 : 0.95)),
      checks_run: run,
    };
  }),
  "ask-again/present": PRESENT,
  "ask-again/trend": daily((i) => {
    const closed = Math.round(conversations(i) * closedShare);
    return { closed, misunderstood: Math.round(closed * (isAfterRelease(i) ? 0.04 : 0.06)) };
  }),
  "ask-again/users": [{ active: 5_820, returning: 1_140 }],
  "ans-outcomes/present": PRESENT,
  "ans-outcomes/totals": [{ closed: CLOSED, closed_previous: Math.round(CLOSED * PREVIOUS) }],
  "ans-outcomes/reasons": [
    { reason: "Refund to a gift card", kind: "capability_gap", in_period: 212, in_previous: 96 },
    { reason: "Read the wrong order", kind: "misunderstood", in_period: 141, in_previous: 158 },
    { reason: "Asked for a person", kind: "handover", in_period: 184, in_previous: 171 },
    { reason: "Change a placed order", kind: "capability_gap", in_period: 118, in_previous: 104 },
    { reason: "Out of scope request", kind: "refusal", in_period: 64, in_previous: 70 },
  ],
  "ans-outcomes/trend": daily((i) => {
    const closed = Math.round(conversations(i) * closedShare);
    const resolved = Math.round(closed * resolvedRate(i));
    const rest = closed - resolved;
    return {
      closed,
      resolved,
      misunderstood: Math.round(rest * 0.3),
      capability_gap: Math.round(rest * 0.32),
      refusal: Math.round(rest * 0.12),
      handover: rest - Math.round(rest * 0.3) - Math.round(rest * 0.32) - Math.round(rest * 0.12),
    };
  }),
  "ans-evaluators/present": PRESENT,
  "ans-evaluators/totals": [{ passed: CHECKS_PASSED, runs: CHECKS }],
  "ans-evaluators/trend": daily((i) => ({ pass_rate: round(checkPassRate(i), 4) })),
  "ans-idk/present": PRESENT,
  "ans-idk/topics": topicRows(({ share, n }) => {
    const closed = Math.round(CLOSED * share);
    return {
      closed,
      refused: Math.round(closed * [0.03, 0.08, 0.05, 0.04, 0.02, 0.06, 0.03, 0.02][n]),
    };
  }),
  "ans-idk/trend": daily((i) => {
    const closed = Math.round(conversations(i) * closedShare);
    return { closed, refused: Math.round(closed * (isAfterRelease(i) ? 0.034 : 0.052)) };
  }),
  "ans-review/present": PRESENT,
  "ans-review/flagged": [
    ["Answer quality", "Promised a refund the policy does not allow", 29, "16:12:41.220"],
    ["Policy compliance", "Shared another customer's order date", 29, "11:03:09.512"],
    ["Answer quality", "Read the wrong order", 28, "18:47:55.004"],
    ["Conversation outcome", "Asked for a person twice", 28, "09:21:37.880"],
    ["Tone", "Curt reply to an upset customer", 27, "14:56:02.310"],
  ].map(([evaluator, reason, day, time], n) => ({
    trace_id: traceId(n + 10),
    evaluator,
    reason,
    at: at(day, time),
    flagged: 38,
  })),
  "ans-review/audit": [{ trace_id: traceId(20) }],
  "so-agreement/present": PRESENT,
  "so-agreement/weekly": MONDAYS.flatMap((day, n) => [
    {
      week: DAYS[day],
      evaluator: "Answer quality",
      reviewed: 46 + n * 3,
      agreement: round(0.84 + n * 0.02 + 0.03 * wobble(n, 21), 3),
      kappa: round(0.66 + n * 0.035 + 0.06 * wobble(n, 22), 3),
    },
    {
      week: DAYS[day],
      evaluator: "Policy compliance",
      reviewed: 31 + n * 2,
      agreement: round(0.92 + n * 0.008 + 0.02 * wobble(n, 23), 3),
      kappa: round(0.8 + n * 0.015 + 0.04 * wobble(n, 24), 3),
    },
  ]),
  "lowest-scores/present": PRESENT,
  "lowest-scores/main": [0.12, 0.18, 0.21, 0.27, 0.31, 0.34].map((score, n) => ({
    trace_id: traceId(n + 30),
    evaluator: n % 2 ? "Policy compliance" : "Answer quality",
    score,
    passed: false,
  })),
  "rag-failure-source/present": PRESENT,
  "rag-failure-source/trend": daily((i) => {
    const searched = Math.round(conversations(i) * 0.8);
    return {
      searched,
      retrieval: Math.round(searched * (isAfterRelease(i) ? 0.03 : 0.05)),
      errors: Math.round(searched * errorRate(i) * 0.4),
      generation: Math.round(searched * 0.02),
    };
  }),
  "rag-empty-retrieval/present": PRESENT,
  "rag-empty-retrieval/trend": daily((i) => {
    const questions = Math.round(conversations(i) * 0.8);
    const empty = Math.round(questions * (isAfterRelease(i) ? 0.025 : 0.045));
    return {
      questions,
      empty_searches: empty,
      empty_errored: i === INCIDENT ? empty : Math.round(empty * 0.1),
    };
  }),

  // Where it breaks, speed, tools.
  "up-errors/present": PRESENT,
  "up-errors/rate": daily((i) => ({ error_rate: round(errorRate(i), 4) })),
  "up-errors/types": [
    ["lookup_order", 0.45],
    ["llm.retry", 0.3],
    ["issue_refund", 0.15],
    ["timeout", 0.1],
  ].flatMap(([category, share]) =>
    daily((i) => ({
      category,
      traces: Math.round(
        traces(i) *
          errorRate(i) *
          share *
          (i === INCIDENT && category === "lookup_order" ? 1.6 : 1),
      ),
    })),
  ),
  "up-errors/changes": releaseChange,
  "up-where-fails/present": PRESENT,
  "up-where-fails/main": [
    { step: "lookup_order", calls: 9_840, failures: 412, recovered: 371 },
    { step: "issue_refund", calls: 2_210, failures: 96, recovered: 61 },
    { step: "search_help_center", calls: 7_650, failures: 58, recovered: 52 },
    { step: "update_address", calls: 640, failures: 21, recovered: 9 },
  ],
  "up-step-latency/present": PRESENT,
  "up-step-latency/latency": [percentiles],
  "up-step-latency/operations": [
    { operation: "generate", total_ms: 9_120_000, p95_ms: 1_910, spans: 14_100 },
    { operation: "lookup_order", total_ms: 3_870_000, p95_ms: 820, spans: 9_840 },
    { operation: "search_help_center", total_ms: 2_440_000, p95_ms: 610, spans: 7_650 },
    { operation: "issue_refund", total_ms: 1_520_000, p95_ms: 1_240, spans: 2_210 },
  ],
  "up-loops/present": PRESENT,
  "up-loops/daily": daily((i) => ({
    looped_traces: Math.round(6 + 4 * wobble(i, 10) + (i === INCIDENT ? 14 : 0)),
    retried_traces: Math.round(18 + 6 * wobble(i, 11) + (i === INCIDENT ? 40 : 0)),
    cost: round(1.4 + 0.5 * wobble(i, 12) + (i === INCIDENT ? 3.1 : 0), 2),
    uncosted_spans: 0,
  })),
  "up-loops/steps": [
    { step: "lookup_order", traces: 142 },
    { step: "search_help_center", traces: 61 },
    { step: "issue_refund", traces: 33 },
  ],
  "up-loops/totals": [{ traces: TRACES, cost: round(COST, 2) }],
  "up-failing-traces/present": PRESENT,
  "up-failing-traces/main": [
    ["lookup_order", 6_210, 0.061, 92],
    ["issue_refund", 4_880, 0.054, 81],
    ["generate", 3_940, 0.047, 74],
    ["lookup_order", 5_120, 0.039, 66],
  ].map(([operation, latency_ms, costOf, impact], n) => ({
    trace_id: traceId(n + 40),
    operation,
    has_error: 1,
    latency_ms,
    cost: costOf,
    feedback: n === 1 ? "down" : "",
    p95_latency: percentiles.p95_ms,
    impact,
  })),
  "tools-error-rate/present": PRESENT,
  "tools-error-rate/main": [
    { step: "lookup_order", calls: 9_840, failures: 412, recovered: 371 },
    { step: "issue_refund", calls: 2_210, failures: 96, recovered: 61 },
    { step: "search_help_center", calls: 7_650, failures: 58, recovered: 52 },
    { step: "update_address", calls: 640, failures: 21, recovered: 9 },
    { step: "check_stock", calls: 1_830, failures: 12, recovered: 12 },
  ],
  "tools-wrong-tool/present": PRESENT,
  "tools-wrong-tool/trend": daily((i) => ({
    wrong_rate: round((isAfterRelease(i) ? 0.031 : 0.052) + 0.01 * wobble(i, 13), 4),
    judged: Math.round(traces(i) * 0.2),
  })),
  "tools-wrong-tool/halves": [{ wrong: 96, judged: 2_390, wrong_first: 131, judged_first: 2_280 }],
  "tools-wrong-tool/changes": releaseChange,
  "latency-slo/present": PRESENT,
  "latency-slo/period": [percentiles],
  "latency-slo/trend": daily((i) => ({ p95_ms: p95(i) })),
  "latency-spread/present": PRESENT,
  "latency-spread/period": [percentiles],
  "latency-spread/trend": daily((i) => ({
    p50_ms: Math.round(p95(i) * 0.46),
    p90_ms: Math.round(p95(i) * 0.8),
    p99_ms: Math.round(p95(i) * 1.7),
  })),
  "slowest-models/present": PRESENT,
  "slowest-models/main": MODELS.map(([model, share, p95_ms]) => ({
    model,
    p95_ms,
    traces: Math.round(TRACES * share),
  })).toSorted((a, b) => b.p95_ms - a.p95_ms),
  "fd-throughput/present": PRESENT,
  "fd-throughput/main": daily((i) => ({
    throughput: traces(i),
    p95_ms: p95(i),
    error_rate: round(errorRate(i), 4),
  })),
  "voice-turn-latency/present": PRESENT,
  "voice-turn-latency/summary": [
    {
      replies: 18_400,
      reply_p95: 1_480,
      listening_p95: 320,
      listening_first_p95: 340,
      listening_second_p95: 300,
      thinking_p95: 690,
      thinking_first_p95: 760,
      thinking_second_p95: 620,
      speaking_p95: 270,
      speaking_first_p95: 280,
      speaking_second_p95: 260,
    },
  ],
  "voice-turn-latency/trend": daily((i) => ({
    listening_p95: Math.round(320 + 40 * wobble(i, 14)),
    thinking_p95:
      i === INCIDENT ? 1_420 : Math.round((isAfterRelease(i) ? 620 : 720) + 80 * wobble(i, 15)),
    speaking_p95: Math.round(270 + 30 * wobble(i, 16)),
  })),
  "voice-call-health/present": PRESENT,
  "voice-call-health/summary": [
    {
      calls: 3_920,
      dropped: 118,
      repeating: 236,
      calls_first: 1_890,
      dropped_first: 71,
      calls_second: 2_030,
      dropped_second: 47,
      repeat_checks: 3_920,
    },
  ],
  "voice-call-health/trend": daily((i) => {
    const calls = Math.round(conversations(i) * 0.3);
    return {
      calls,
      dropped: Math.round(calls * droppedShare(i)),
      repeating: Math.round(calls * 0.06),
    };
  }),

  // Change, evaluations, sign-off, trust.
  "token-drift/present": PRESENT,
  "token-drift/main": daily((i) => ({
    prompt_tokens: Math.round(traces(i) * (isAfterRelease(i) ? 1_820 : 2_140)),
    completion_tokens: Math.round(traces(i) * 410),
  })),
  "fd-quality/present": PRESENT,
  "fd-quality/passRate": daily((i) => ({ pass_rate: round(checkPassRate(i), 4) })),
  "fd-quality/errorRate": daily((i) => ({ error_rate: round(errorRate(i), 4) })),
  "so-changes/present": PRESENT,
  "so-changes/main": [
    { at: at(RELEASE, "10:42:00.000"), kind: "prompt", name: "support-agent v14" },
    { at: at(12, "15:05:00.000"), kind: "model", name: "claude-sonnet-4.5" },
    { at: at(4, "09:30:00.000"), kind: "prompt", name: "support-agent v13" },
  ],
  "evaluation-coverage/present": PRESENT,
  "evaluation-coverage/traffic": [{ traces: TRACES }],
  "evaluation-coverage/evaluated": [{ traces: Math.round(TRACES * 0.82) }],
  "evaluation-coverage/evaluators": [
    ["PII", 1, 0.998],
    ["Prompt injection", 1, 0.997],
    ["Answer quality", 0.7, 0.912],
    ["Policy compliance", 0.55, 0.948],
    ["Tone", 0.4, 0.963],
    ["Conversation outcome", 0.3, 0.822],
  ].map(([evaluator, share, pass_rate]) => ({
    evaluator,
    runs: Math.round(TRACES * 0.82 * share),
    traces: Math.round(TRACES * 0.82 * share),
    pass_rate,
  })),
  "lowest-passing-evaluators/present": PRESENT,
  "lowest-passing-evaluators/main": [
    { evaluator: "Conversation outcome", pass_rate: 0.822, runs: 4_210 },
    { evaluator: "Answer quality", pass_rate: 0.912, runs: 9_830 },
    { evaluator: "Policy compliance", pass_rate: 0.948, runs: 7_720 },
    { evaluator: "Tone", pass_rate: 0.963, runs: 5_610 },
  ],
  "so-verdict/present": PRESENT,
  "so-verdict/traffic": [{ traces: TRACES }],
  "so-verdict/guardrails": [
    { control: "PII", checked: TRACES, flagged: 38, flagged_before: 52 },
    { control: "Prompt injection", checked: TRACES, flagged: 11, flagged_before: 9 },
    { control: "Content policy", checked: Math.round(TRACES * 0.9), flagged: 4, flagged_before: 6 },
  ],
  "so-verdict/backlog": [{ pending: 23, pending_before: 41 }],
  "so-rubric/present": PRESENT,
  "so-rubric/main": [
    { criterion: "Follows the refund policy", passed: 2_230, judged: 2_390 },
    { criterion: "Cites the order it read", passed: 2_150, judged: 2_390 },
    { criterion: "No personal data shared", passed: 2_381, judged: 2_390 },
    { criterion: "Offers a person when asked", passed: 2_270, judged: 2_390 },
  ],
  "so-queue/present": PRESENT,
  "so-queue/summary": [
    { came_in: 612, reviewed: 630, pending: 23, pending_before: 41, wait_seconds: 15_840 },
  ],
  "so-queue/flow": daily((i) => ({
    came_in: Math.round(20 + 6 * wobble(i, 17) - (isWeekend(i) ? 8 : 0)),
    reviewed: isWeekend(i) ? 0 : Math.round(25 + 6 * wobble(i, 18)),
  })),
  "data-health/fields": [
    { field: "all", traces: TRACES },
    { field: "model", traces: Math.round(TRACES * 0.991) },
    { field: "cost", traces: Math.round(TRACES * 0.962) },
    { field: "user", traces: Math.round(TRACES * 0.94) },
    { field: "conversation", traces: Math.round(TRACES * 0.998) },
    { field: "labels", traces: Math.round(TRACES * 0.41) },
    { field: "outcome", traces: Math.round(TRACES * 0.88) },
  ],
  "cost-accuracy/models": [
    { model: "returns-tuned-v2", traces: 412 },
    { model: "embed-small-eu", traces: 96 },
  ],
  "cost-accuracy/trend": daily((i) => ({
    with_model: traces(i),
    unpriced: i >= 9 ? Math.round(traces(i) * 0.04) : 0,
  })),
  "noise/sources": [
    { source: "", traces: TRACES, cost: round(COST, 2) },
    { source: "evaluation", traces: Math.round(TRACES * 0.11), cost: round(COST * 0.11, 2) },
    { source: "staging", traces: Math.round(TRACES * 0.06), cost: round(COST * 0.05, 2) },
    { source: "playground", traces: Math.round(TRACES * 0.02), cost: round(COST * 0.02, 2) },
  ],

  // Per customer, per call, per document, per output.
  "att-share/present": PRESENT,
  "att-share/totals": [unitTotals],
  "att-share/units": units("langwatch.customer_id"),
  "cost-by-segment/present": PRESENT,
  "cost-by-segment/totals": [unitTotals],
  "cost-by-segment/units": units("langwatch.customer_id").map(
    ({ unit_key, unit, cost: unitCost }) => ({
      unit_key,
      unit,
      cost: unitCost,
    }),
  ),
  "att-table/present": PRESENT,
  "att-table/units": units("langwatch.customer_id"),
  "att-table/passRates": CUSTOMERS.map(([unit, share], n) => {
    const judged = Math.round(CHECKS * share);
    return {
      unit,
      passed: Math.round(judged * (n === 2 ? 0.86 : 0.94 + 0.02 * wobble(n, 19))),
      judged,
      passed_before: Math.round(judged * 0.9 * 0.92),
      judged_before: Math.round(judged * 0.9),
    };
  }),
  "att-change/present": PRESENT,
  "att-change/change": [
    {
      version: "support-agent v14",
      changed_at: at(RELEASE, "10:42:00.000"),
      previous: "support-agent v13",
    },
  ],
  "att-change/units": CUSTOMERS.flatMap(([unit, share], n) =>
    ["support-agent v13", "support-agent v14"].map((version, after) => {
      const judged = Math.round(CHECKS * share * (after ? 0.3 : 0.7));
      const passedBefore = n === 2 ? 0.85 : 0.91;
      return {
        unit_key: "langwatch.customer_id",
        unit,
        version,
        first_seen: at(after ? RELEASE : 1, "10:42:00.000"),
        passed: Math.round(judged * (after ? 0.95 : passedBefore)),
        judged,
      };
    }),
  ),
  "ext-field-accuracy/present": PRESENT,
  "ext-field-accuracy/checks": [
    ["Invoice", 4_120],
    ["Receipt", 1_380],
    ["Credit note", 640],
    ["Delivery note", 410],
  ].map(([unit, checked]) => ({ unit_key: "metadata.document_type", unit, checked })),
  "ext-field-accuracy/wrong": [
    ["Invoice", "vat_number", 96],
    ["Invoice", "due_date", 41],
    ["Receipt", "total", 38],
    ["Credit note", "original_invoice", 52],
    ["Delivery note", "po_number", 27],
  ].map(([unit, field, wrong]) => ({ unit, field, wrong })),
  "ext-human-review/present": PRESENT,
  "ext-human-review/summary": [
    { traces: 6_550, documents: 6_550, sent: 412, documents_first: 3_180, sent_first: 251 },
  ],
  "ext-human-review/byUnit": CUSTOMERS.slice(0, 5).map(([unit, share], n) => ({
    unit_key: "langwatch.customer_id",
    unit,
    documents: Math.round(6_550 * share),
    sent: Math.round(6_550 * share * [0.05, 0.08, 0.04, 0.11, 0.06][n]),
  })),
  "ext-human-review/trend": daily((i) => {
    const documents = Math.round(conversations(i) * 0.5);
    return { documents, sent: Math.round(documents * (isAfterRelease(i) ? 0.05 : 0.075)) };
  }),
  "gen-dropoff/present": PRESENT,
  "gen-dropoff/main": [{ traces: 6_480, generated: 6_210, used: 4_830, accepted: 3_910 }],
  "top-models/present": PRESENT,
  "top-models/traffic": [{ traces: TRACES }],
  "top-models/models": MODELS.map(([model, share]) => ({
    model,
    traces: Math.round(TRACES * share),
  })),
  "top-models/modelCosts": MODELS.map(([model, share]) => ({
    model,
    cost: round(COST * share, 2),
  })),
};
