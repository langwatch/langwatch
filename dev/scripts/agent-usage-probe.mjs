#!/usr/bin/env node
/**
 * agent-usage-probe — fixed-definition measurement of coding-agent usage.
 *
 * Run it against a `langwatch trace export --origin coding_agent` JSONL file.
 * It emits a machine-readable "card" of AGGREGATES ONLY, so the file it
 * produces can be shared without exposing any prompt, command, file path or
 * repository name.
 *
 * Why a script and not a prompt: three people asking an agent to "compute the
 * carry ratio" get three definitions, and the comparison is then worthless.
 * Every number below is defined exactly once, here.
 *
 * READS:   metadata.thread_id, metadata.models, metadata.service.name,
 *          timestamps.started_at, metrics.*, error
 * EMITS:   counts, sums, percentiles. No identifiers, no free text.
 *
 *   node agent-usage-probe.mjs <export.jsonl> [--label "<your label>"] [--out card.json]
 */
import fs from "node:fs";
import crypto from "node:crypto";

const PROBE_VERSION = "1.0.0";

// ---------------------------------------------------------------- arguments
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
if (!file || !fs.existsSync(file)) {
  console.error("usage: node agent-usage-probe.mjs <export.jsonl> [--label X] [--out card.json]");
  process.exit(1);
}
const label = flag("label", "unlabelled");
const outPath = flag("out", "agent-usage-card.json");
// Opt-in. Reads your own prompt text LOCALLY to score frustration markers and
// emits rates only — no text, no matched words, nothing quotable. Off unless
// you ask for it, because every other number here is derived from counts alone.
const wantFrustration = args.includes("--frustration");

// ---------------------------------------------------------------- utilities
const hash = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 12);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const pct = (part, whole) => (whole > 0 ? +((part / whole) * 100).toFixed(2) : 0);
const round = (v, d = 2) => +Number(v).toFixed(d);
const pctl = (sorted, p) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))] : 0;
const dist = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length
    ? {
        n: s.length,
        min: round(s[0]),
        p10: round(pctl(s, 0.1)),
        median: round(pctl(s, 0.5)),
        p90: round(pctl(s, 0.9)),
        p99: round(pctl(s, 0.99)),
        max: round(s.at(-1)),
      }
    : { n: 0 };
};

// ---------------------------------------------------------------- ingestion
const rows = fs
  .readFileSync(file, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

const trace = (r) => {
  const m = r.metrics ?? {};
  const md = r.metadata ?? {};
  return {
    sid: md.thread_id ?? null,
    project: r.project_id ?? null,
    user: md.user_id ?? null,
    harness: md["service.name"] ?? md["langwatch.source"] ?? "unknown",
    model: (Array.isArray(md.models) ? md.models[0] : md.model) ?? "unknown",
    t: num(r.timestamps?.started_at),
    ms: num(m.total_time_ms),
    cost: num(m.total_cost),
    prompt: num(m.prompt_tokens),
    completion: num(m.completion_tokens),
    reads: num(m.cache_read_input_tokens),
    writes: num(m.cache_creation_input_tokens),
    ctx: num(m.context_size_tokens),
    errored: r.error != null && r.error !== false,
    text: wantFrustration ? (typeof r.input === "object" ? (r.input?.value ?? null) : r.input ?? null) : null,
  };
};
const T = rows.map(trace).filter((t) => t.t > 0);
if (!T.length) {
  console.error("no usable traces in that file");
  process.exit(1);
}
T.sort((a, b) => a.t - b.t);

// ---------------------------------------------------------------- 1. corpus
const totalCost = sum(T.map((t) => t.cost));
const totalReads = sum(T.map((t) => t.reads));
const totalCompletion = sum(T.map((t) => t.completion));
const days = (T.at(-1).t - T[0].t) / 86400000;

const byKey = (key) => {
  const m = new Map();
  for (const t of T) m.set(t[key], (m.get(t[key]) ?? 0) + t.cost);
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ name: k, cost_share_pct: pct(v, totalCost) }));
};

// -------------------------------------------------------------- 2. sessions
const S = new Map();
for (const t of T) {
  if (!t.sid) continue;
  let s = S.get(t.sid);
  if (!s) {
    s = { traces: [], cost: 0, reads: 0, completion: 0, first: t.t, last: t.t, peak: 0 };
    S.set(t.sid, s);
  }
  s.traces.push(t);
  s.cost += t.cost;
  s.reads += t.reads;
  s.completion += t.completion;
  s.first = Math.min(s.first, t.t);
  s.last = Math.max(s.last, t.t);
  s.peak = Math.max(s.peak, t.ctx);
}
const sessions = [...S.values()];
const sessionCosts = sessions.map((s) => s.cost).sort((a, b) => b - a);

const topShare = (fraction) => {
  const k = Math.ceil(sessions.length * fraction);
  return { sessions: k, cost_share_pct: pct(sum(sessionCosts.slice(0, k)), totalCost) };
};

const lifetimeBand = (loH, hiH) => {
  const sel = sessions.filter((s) => {
    const h = (s.last - s.first) / 3600000;
    return h >= loH && h < hiH;
  });
  return {
    sessions: sel.length,
    session_share_pct: pct(sel.length, sessions.length),
    cost_share_pct: pct(sum(sel.map((s) => s.cost)), totalCost),
  };
};

const peakBand = (lo, hi) => {
  const sel = sessions.filter((s) => s.peak >= lo && s.peak < hi);
  return { sessions: sel.length, cost_share_pct: pct(sum(sel.map((s) => s.cost)), totalCost) };
};

// --------------------------------------------------------- 3. context floor
// The first measured context of a session approximates the static prefix
// (system prompt + tool definitions + instruction files + skills index).
// UPPER BOUND: a long first user prompt inflates it. Reported as a band.
const firstCtx = sessions
  .map((s) => s.traces.slice().sort((a, b) => a.t - b.t).find((t) => t.ctx > 0)?.ctx ?? 0)
  .filter((c) => c > 0);
const floorDist = dist(firstCtx);
const floorMedian = floorDist.median ?? 0;

// The prefix is re-read on EVERY model call, not every turn. Implied calls are
// bounded by total reads / median context, which is the only call count a
// trace-grained export can support.
const medianCtxAll = pctl(
  T.map((t) => t.ctx).filter(Boolean).sort((a, b) => a - b),
  0.5,
);
const impliedCalls = medianCtxAll > 0 ? Math.round(totalReads / medianCtxAll) : 0;
const floorShare = pct(floorMedian * impliedCalls, totalReads);

// ----------------------------------------------- 4. long-context premium(!)
// Open question: does $/token step up above a context threshold? Measured as
// realised cost per cache-read token, by context band. A flat series means no
// premium on this account's traffic; a rising one means context size is priced
// twice — once in volume, once in rate.
const ctxBands = [
  [0, 50e3],
  [50e3, 100e3],
  [100e3, 200e3],
  [200e3, 400e3],
  [400e3, 700e3],
  [700e3, 1e9],
];
const premium = ctxBands.map(([lo, hi]) => {
  const sel = T.filter((t) => t.ctx >= lo && t.ctx < hi && t.reads > 0 && t.cost > 0);
  const r = sum(sel.map((t) => t.reads));
  return {
    band: hi > 1e8 ? `>${lo / 1000}k` : `${lo / 1000}k-${hi / 1000}k`,
    traces: sel.length,
    cost_share_pct: pct(sum(sel.map((t) => t.cost)), totalCost),
    usd_per_million_read_tokens: r > 0 ? round((sum(sel.map((t) => t.cost)) / r) * 1e6, 3) : null,
  };
});

// ------------------------------------------------------------ 5. carry ratio
// reads / completion. Reported per session, never pooled alone: a single
// session can dominate the pooled figure. Also note it REWARDS VERBOSITY —
// completion includes thinking, so more thinking lowers it with no behaviour
// change. Compare distributions, not point values.
const carryPerSession = sessions.filter((s) => s.completion > 0).map((s) => s.reads / s.completion);
const carry = {
  pooled: totalCompletion > 0 ? round(totalReads / totalCompletion, 1) : null,
  per_session: dist(carryPerSession),
  caveat: "pooled figure is dominated by the largest session; compare per_session",
};

// ---------------------------------------- 6. compaction / context resets
// A context drop of >25% between consecutive traces in a session is a reset
// (compaction, /clear, or a fork). Counts resets, not their cause.
let resets = 0;
let sessionsWithReset = 0;
for (const s of sessions) {
  const ordered = s.traces.slice().sort((a, b) => a.t - b.t).filter((t) => t.ctx > 0);
  let n = 0;
  for (let i = 1; i < ordered.length; i++) if (ordered[i].ctx < ordered[i - 1].ctx * 0.75) n++;
  resets += n;
  if (n > 0) sessionsWithReset++;
  s.resets = n;
}

// ------------------------------------------ 7. checkpoint counterfactual
// If a session checkpointed whenever context passed C — handing off a summary
// and restarting — how much cache-read volume would it not have paid for?
//
// MODEL, stated so it can be attacked:
//  - a trace's read volume is proportional to its context size;
//  - growth between consecutive traces is preserved (the same work happens);
//  - a checkpoint resets context to floor + HANDOFF_TOKENS;
//  - each checkpoint re-pays the floor as a cache WRITE at 1.25x read rate.
// NOT MODELLED: quality loss, re-derivation, the human cost of the handoff.
// Treat as an upper bound on the saving.
const HANDOFF_TOKENS = 15_000;
const checkpointAt = (C) => {
  let actual = 0;
  let simulated = 0;
  let checkpoints = 0;
  for (const s of sessions) {
    const ordered = s.traces
      .slice()
      .sort((a, b) => a.t - b.t)
      .filter((t) => t.ctx > 0 && t.reads > 0);
    if (ordered.length < 2) {
      const r = sum(ordered.map((t) => t.reads));
      actual += r;
      simulated += r;
      continue;
    }
    let simCtx = ordered[0].ctx;
    for (let i = 0; i < ordered.length; i++) {
      const t = ordered[i];
      if (i > 0) simCtx += Math.max(0, t.ctx - ordered[i - 1].ctx);
      if (simCtx > C) {
        checkpoints++;
        simCtx = floorMedian + HANDOFF_TOKENS;
      }
      actual += t.reads;
      simulated += t.reads * Math.min(1, simCtx / Math.max(t.ctx, 1));
    }
  }
  const writeTokens = checkpoints * floorMedian * 1.25;
  const savedTokens = actual - simulated - writeTokens;
  return {
    threshold_tokens: C,
    checkpoints_implied: checkpoints,
    read_tokens_saved_pct: pct(savedTokens, actual),
    est_cost_saved_usd: round((savedTokens / Math.max(actual, 1)) * totalCost),
  };
};
const checkpointing = [150e3, 200e3, 300e3, 500e3].map(checkpointAt);

// -------------------------------------------------------------- 8. population
// Heavy vs light traces. Light traces are classifiers, title generation and
// similar background calls; they inflate trace counts and tell you nothing.
const heavy = T.filter((t) => t.cost >= 0.01);
const light = T.filter((t) => t.cost < 0.01);

// --------------------------------------------- 8b. frustration (opt-in)
// Scores prompt text for two lexicons and emits RATES ONLY. No text, no
// matched words, no quotable fragment ever reaches the card. Off unless
// --frustration is passed.
//
// Two findings this is testing, from one account — see Part 8:
//   - within a session, frustration roughly doubles from first third to last;
//   - profanity LEADS a context reset while aimed repetition LAGS it.
const LEX_SWEAR =
  /\b(?:fuck\w*|cunt\w*|motherfuck\w*|shit\w*|bollocks|wank\w*|twat\w*|bastard\w*|arsehole\w*|pissed|pissing|damn\w*|crap\w*|bloody|bugger\w*|arse|sodding)\b/i;
const LEX_TOLD =
  /\b(?:as i (?:said|told you|asked)|i (?:said|told you|asked you)|like i said|i already|you (?:keep|still|again)|stop doing|i didn'?t (?:say|ask|want)|that'?s not what)\b/i;
const STRIP_TAGS = [
  /<system-reminder>[\s\S]*?<\/system-reminder>/g,
  /<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g,
  /<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g,
  /<command-(?:name|message|args)>[\s\S]*?<\/command-(?:name|message|args)>/g,
  /```[\s\S]*?```/g,
];

const frustration = (() => {
  if (!wantFrustration) return null;
  const scored = [];
  for (const t of T) {
    if (typeof t.text !== "string" || !t.text.trim()) continue;
    let txt = t.text;
    for (const rx of STRIP_TAGS) txt = txt.replace(rx, " ");
    if (!txt.trim()) continue;
    scored.push({ ...t, swear: LEX_SWEAR.test(txt), told: LEX_TOLD.test(txt) });
  }
  if (scored.length < 50) return { prompts_with_text: scored.length, note: "too few prompts to score" };

  const r = (sel, k) => (sel.length ? pct(sel.filter((x) => x[k]).length, sel.length) : 0);

  // within-session: first third vs last third
  const bySess = new Map();
  for (const s of scored) {
    if (!s.sid) continue;
    if (!bySess.has(s.sid)) bySess.set(s.sid, []);
    bySess.get(s.sid).push(s);
  }
  const firstT = [], lastT = [];
  for (const ms of bySess.values()) {
    if (ms.length < 6) continue;
    ms.sort((a, b) => a.t - b.t);
    const k = Math.floor(ms.length / 3);
    firstT.push(...ms.slice(0, k));
    lastT.push(...ms.slice(-k));
  }

  // around a context reset: K prompts either side, same session
  const K = 5;
  const before = [], after = [];
  for (const s of sessions) {
    const ordered = s.traces.slice().sort((a, b) => a.t - b.t);
    const scoredIds = new Set(scored.map((x) => x.t));
    for (let i = 1; i < ordered.length; i++) {
      if (!(ordered[i].ctx && ordered[i - 1].ctx && ordered[i].ctx < ordered[i - 1].ctx * 0.75)) continue;
      let got = 0;
      for (let j = i - 1; j >= 0 && got < K; j--) {
        if (!scoredIds.has(ordered[j].t)) continue;
        const m = scored.find((x) => x.t === ordered[j].t);
        if (m) { before.push(m); got++; }
      }
      got = 0;
      for (let j = i; j < ordered.length && got < K; j++) {
        if (!scoredIds.has(ordered[j].t)) continue;
        const m = scored.find((x) => x.t === ordered[j].t);
        if (m) { after.push(m); got++; }
      }
    }
  }

  return {
    prompts_with_text: scored.length,
    baseline_profanity_pct: r(scored, "swear"),
    baseline_aimed_repetition_pct: r(scored, "told"),
    profanity_events: scored.filter((x) => x.swear).length,
    within_session: {
      sessions_used: [...bySess.values()].filter((m) => m.length >= 6).length,
      n_per_group: firstT.length,
      first_third_profanity_pct: r(firstT, "swear"),
      last_third_profanity_pct: r(lastT, "swear"),
      first_third_aimed_repetition_pct: r(firstT, "told"),
      last_third_aimed_repetition_pct: r(lastT, "told"),
    },
    around_reset: {
      n_before: before.length,
      n_after: after.length,
      profanity_before_pct: r(before, "swear"),
      profanity_after_pct: r(after, "swear"),
      aimed_repetition_before_pct: r(before, "told"),
      aimed_repetition_after_pct: r(after, "told"),
    },
    note: "rates only; no text or matched words are stored or emitted",
  };
})();

// ------------------------------------------------------------------ 9. card
const card = {
  probe_version: PROBE_VERSION,
  generated_at: new Date().toISOString(),
  label,
  workspace_fingerprint: hash([...new Set(T.map((t) => t.project))].sort().join(",")),
  corpus: {
    traces: T.length,
    sessions: sessions.length,
    distinct_users: new Set(T.map((t) => t.user)).size,
    window_days: round(days, 1),
    first_trace: new Date(T[0].t).toISOString().slice(0, 10),
    last_trace: new Date(T.at(-1).t).toISOString().slice(0, 10),
    total_cost_usd: round(totalCost),
    cost_per_day_usd: round(totalCost / Math.max(days, 1)),
    total_cache_read_tokens: totalReads,
    total_completion_tokens: totalCompletion,
  },
  harnesses: byKey("harness"),
  models: byKey("model"),
  carry_ratio: carry,
  spend_concentration: {
    top_1_pct: topShare(0.01),
    top_5_pct: topShare(0.05),
    top_10_pct: topShare(0.1),
    largest_session_share_pct: pct(sessionCosts[0] ?? 0, totalCost),
    session_cost_usd: dist(sessionCosts),
  },
  session_lifetime: {
    under_1h: lifetimeBand(0, 1),
    "1h_to_8h": lifetimeBand(1, 8),
    "8h_to_24h": lifetimeBand(8, 24),
    "1d_to_3d": lifetimeBand(24, 72),
    over_3d: lifetimeBand(72, 1e9),
    hours: dist(sessions.map((s) => (s.last - s.first) / 3600000)),
  },
  context: {
    first_context_tokens: floorDist,
    floor_note: "upper bound on the static prefix; a long first prompt inflates it",
    implied_model_calls: impliedCalls,
    instruction_floor_share_of_reads_pct: floorShare,
    peak_context: dist(sessions.map((s) => s.peak)),
    peak_bands: {
      under_200k: peakBand(0, 200e3),
      "200k_to_500k": peakBand(200e3, 500e3),
      "500k_to_900k": peakBand(500e3, 900e3),
      over_900k: peakBand(900e3, 1e9),
    },
  },
  long_context_premium: premium,
  context_resets: {
    total: resets,
    sessions_with_a_reset: sessionsWithReset,
    sessions_with_a_reset_pct: pct(sessionsWithReset, sessions.length),
    resets_per_session: dist(sessions.map((s) => s.resets ?? 0)),
  },
  checkpoint_counterfactual: {
    model: "upper bound; quality loss and re-derivation not modelled",
    handoff_tokens_assumed: HANDOFF_TOKENS,
    by_threshold: checkpointing,
  },
  population: {
    heavy_traces: {
      n: heavy.length,
      share_pct: pct(heavy.length, T.length),
      cost_share_pct: pct(sum(heavy.map((t) => t.cost)), totalCost),
    },
    light_traces: {
      n: light.length,
      share_pct: pct(light.length, T.length),
      cost_share_pct: pct(sum(light.map((t) => t.cost)), totalCost),
      median_duration_ms: pctl(light.map((t) => t.ms).sort((a, b) => a - b), 0.5),
      median_completion_tokens: pctl(light.map((t) => t.completion).sort((a, b) => a - b), 0.5),
    },
  },
  trace_error_rate_pct: pct(T.filter((t) => t.errored).length, T.length),
  ...(frustration ? { frustration } : {}),
};

fs.writeFileSync(outPath, JSON.stringify(card, null, 2));

// -------------------------------------------------------------- 10. readable
const c = card;
const line = (k, v) => console.log(`  ${String(k).padEnd(38)} ${v}`);
console.log(`\n  agent-usage-probe ${PROBE_VERSION} — ${label}\n  ${"─".repeat(62)}`);
line("traces / sessions", `${c.corpus.traces.toLocaleString()} / ${c.corpus.sessions}`);
line("window", `${c.corpus.first_trace} → ${c.corpus.last_trace} (${c.corpus.window_days}d)`);
line("total cost", `$${c.corpus.total_cost_usd.toLocaleString()} ($${c.corpus.cost_per_day_usd}/day)`);
line(
  "carry ratio (per-session median)",
  `${c.carry_ratio.per_session.median}:1 (pooled ${c.carry_ratio.pooled}:1)`,
);
line("top 1% of sessions", `${c.spend_concentration.top_1_pct.cost_share_pct}% of spend`);
line("largest single session", `${c.spend_concentration.largest_session_share_pct}% of spend`);
line(
  "sessions over 3 days",
  `${c.session_lifetime.over_3d.session_share_pct}% of sessions, ${c.session_lifetime.over_3d.cost_share_pct}% of spend`,
);
line("first-context median", `${(c.context.first_context_tokens.median ?? 0).toLocaleString()} tokens`);
line("instruction floor share of reads", `${c.context.instruction_floor_share_of_reads_pct}%`);
line(
  "peak context over 500k",
  `${round(c.context.peak_bands["500k_to_900k"].cost_share_pct + c.context.peak_bands.over_900k.cost_share_pct)}% of spend`,
);
line("context resets", `${c.context_resets.total} across ${c.context_resets.sessions_with_a_reset_pct}% of sessions`);
line(
  "light traces",
  `${c.population.light_traces.share_pct}% of traces, ${c.population.light_traces.cost_share_pct}% of spend`,
);
console.log(`\n  long-context premium — realised $/M cache-read tokens by band`);
for (const b of c.long_context_premium) {
  if (!b.traces) continue;
  console.log(
    `  ${b.band.padEnd(14)} ${String(b.traces).padStart(6)} traces ${String(b.cost_share_pct).padStart(6)}% of spend   $${b.usd_per_million_read_tokens}/M`,
  );
}
console.log(`\n  checkpoint counterfactual (upper bound)`);
for (const k of c.checkpoint_counterfactual.by_threshold) {
  console.log(
    `  cap at ${String(k.threshold_tokens / 1000 + "k").padEnd(8)} ${String(k.checkpoints_implied).padStart(5)} checkpoints  ${String(k.read_tokens_saved_pct).padStart(6)}% of read tokens  ~$${k.est_cost_saved_usd}`,
  );
}
if (frustration && frustration.within_session) {
  const f = frustration;
  console.log(`\n  frustration signal (opt-in; rates only, no text retained)`);
  console.log(`  ${f.prompts_with_text.toLocaleString()} prompts with text, ${f.profanity_events} profanity events, baseline ${f.baseline_profanity_pct}%`);
  console.log(`  within session   first third ${f.within_session.first_third_profanity_pct}% → last third ${f.within_session.last_third_profanity_pct}%  (n=${f.within_session.n_per_group} each)`);
  console.log(`  around a reset   profanity ${f.around_reset.profanity_before_pct}% before → ${f.around_reset.profanity_after_pct}% after`);
  console.log(`                   repetition ${f.around_reset.aimed_repetition_before_pct}% before → ${f.around_reset.aimed_repetition_after_pct}% after`);
}
console.log(`\n  card written to ${outPath}\n`);
