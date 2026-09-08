/**
 * Placeholder series for the Costs panels whose backing data does not exist
 * yet — agents, prepaid seats, forecasts, token counts and Genie questions.
 * Nothing here reads the database, and every panel drawn from this module is
 * badged `sample` in the UI so a reader never mistakes these figures for the
 * organization's own money.
 *
 * The numbers are generated from a seeded pseudo-random sequence rather than
 * `Math.random`, so a given label always paints the same shape. That keeps the
 * server-rendered markup identical to the client's first paint, and keeps the
 * page from reshuffling itself on every re-render.
 *
 * Panels backed by real reads — total spend, cost by department, cost by user,
 * cost by model, cost over time — do not come through here.
 *
 * Spec: specs/ai-gateway/governance/governance-home-routing.feature
 * (the billed-cost flag section).
 */

export interface RankRow {
  key: string;
  label: string;
  value: number;
}

export interface DailyPoint {
  key: string;
  label: string;
  value: number;
}

export interface DailyBucket {
  day: string;
  points: DailyPoint[];
}

/**
 * Mulberry32. Small, fast, and — the only property we actually need —
 * completely determined by its seed.
 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a label, so each series seeds itself. */
function hashLabel(label: string): number {
  let hash = 2166136261;
  for (let i = 0; i < label.length; i++) {
    hash ^= label.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export const SAMPLE_AGENTS = [
  "support-copilot-prod",
  "checkout-agent-prod",
  "fraud-triage-prod",
  "churn-predictor",
  "docs-rag-prod",
  "revenue-forecaster",
  "etl-doctor",
  "hr-helpdesk",
] as const;

export const SAMPLE_DEPARTMENTS = [
  "Engineering",
  "Data & AI",
  "Customer Support",
  "Marketing",
  "Unallocated",
] as const;

/**
 * The licence pools the sample seat panel shows, named the way a provider
 * names them — a part number, not a product. ADR-128 §6 stores seat counts
 * against the provider's own SKU, so a sample that invented friendly names
 * would teach the reader a vocabulary the real screen never uses.
 */
export const SAMPLE_SEAT_POOLS = [
  "VIRTUAL_AGENT_USL",
  "COPILOT_STUDIO_PRO",
  "GITHUB_COPILOT_BUSINESS",
] as const;

/**
 * The last `count` months ending with this one, as ISO first-of-month days.
 *
 * Months rather than days because governance is read at a governance cadence:
 * the finest bucket any chip on this page offers is a month (see
 * `~/components/governance/filters/timeControls.ts`), so generating a year of
 * daily noise only to fold every one of it away is work nobody sees. Callers
 * hold this in a `useMemo` so the window is read from the clock once per
 * render pass rather than once per series.
 */
export function recentMonths(count: number): string[] {
  const out: string[] = [];
  const today = new Date();
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(Date.UTC(year, month - i, 1));
    out.push(start.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * A ranked list that falls away steeply from its leader, the way real spend
 * does — one agent carrying most of the bill and a long tail beneath it.
 */
export function sampleRanked(
  labels: readonly string[],
  topValue: number,
): RankRow[] {
  return labels.map((label, index) => {
    const random = seededRandom(hashLabel(label));
    const decay = 0.42 ** index;
    const jitter = 0.75 + random() * 0.5;
    return {
      key: label,
      label,
      value: Math.round(topValue * decay * jitter),
    };
  });
}

/**
 * One bucket per period in `days`, with one stacked segment per label. The
 * periods are whatever the caller passes — months, today — and the fold in
 * `costsWindow.ts` widens them to the interval in view from there.
 */
export function sampleDaily(
  days: string[],
  labels: readonly string[],
  dailyTopValue: number,
): DailyBucket[] {
  const randomByLabel = new Map(
    labels.map((label) => [label, seededRandom(hashLabel(label))]),
  );
  return days.map((day) => ({
    day,
    points: labels.map((label, index) => {
      const random = randomByLabel.get(label)!;
      const decay = 0.5 ** index;
      return {
        key: label,
        label,
        value: Math.round(dailyTopValue * decay * (0.35 + random() * 1.3)),
      };
    }),
  }));
}

/** A single spiky line — token counts rather than money. */
export function sampleLine(
  days: string[],
  seed: string,
  midpoint: number,
): Array<{ day: string; value: number }> {
  const random = seededRandom(hashLabel(seed));
  return days.map((day) => ({
    day,
    value: Math.round(midpoint * (0.3 + random() * 1.7)),
  }));
}

/**
 * Metered spend split into the part already served and the part still
 * projected, so the forecast panel can paint the run-rate tail in a lighter
 * shade. The last quarter of the window is the projection.
 */
export function sampleForecast(
  days: string[],
  labels: readonly string[],
  dailyTopValue: number,
): { buckets: DailyBucket[]; projectedFromDay: string | null } {
  const splitIndex = Math.floor(days.length * 0.75);
  return {
    buckets: sampleDaily(days, labels, dailyTopValue),
    projectedFromDay: days[splitIndex] ?? null,
  };
}

/**
 * Seat counts over time — bought against assigned, per period.
 *
 * COUNTS, never money. ADR-128 §6 stores what the roster reported as a plain
 * number and §6's own reversal note says seats ship as counts only, because
 * what those seats cost is already on the invoice the billed lane reads. A
 * sample panel that drew seats in dollars would teach the reader to expect a
 * figure the product deliberately refuses to show, so this one is scaled in
 * seats and drawn on a seat axis.
 *
 * Bought and assigned are separate series rather than a stack: stacking them
 * would draw a bar of bought-plus-assigned, a height nobody holds. The gap
 * between the two bars is the whole point of the panel — it is §16's wave-1
 * idle-seat aggregate, "you pay for N, M are assigned".
 */
export function sampleSeats(
  periods: string[],
  pools: readonly string[] = SAMPLE_SEAT_POOLS,
  seatsPerPool = 140,
): DailyBucket[] {
  const boughtRandom = seededRandom(hashLabel("seats-bought"));
  const assignedRandom = seededRandom(hashLabel("seats-assigned"));
  return periods.map((day, index) => {
    // Bought grows in steps, the way a company buys licences: a block at a
    // time, and it never falls back on its own.
    const bought = Math.round(
      pools.length * seatsPerPool * (1 + index * 0.04 + boughtRandom() * 0.05),
    );
    // Assigned trails it. Never above, because a provider cannot seat more
    // people than the licences bought, and the panel would read as a defect.
    const assigned = Math.round(bought * (0.62 + assignedRandom() * 0.24));
    return {
      day,
      points: [
        { key: "bought", label: "Seats bought", value: bought },
        { key: "assigned", label: "Seats assigned", value: assigned },
      ],
    };
  });
}

/** What the Adoption panel shows when nothing has been measured yet. */
export interface SampleAdoption {
  peopleUsingAiTools: number;
  activeSeats: number;
  toolsAdopted: number;
  /** Change in people using AI tools against the previous period, per cent. */
  trendPct: number;
}

/**
 * Adoption figures for an organization with nothing measured yet.
 *
 * Fixed rather than generated: these are four headline numbers a reader looks
 * at once, and a seeded sequence would only make them harder to recognise as
 * invented when they turn up in a screenshot.
 */
export function sampleAdoption(): SampleAdoption {
  return {
    peopleUsingAiTools: 184,
    activeSeats: 236,
    toolsAdopted: 7,
    trendPct: 12,
  };
}
