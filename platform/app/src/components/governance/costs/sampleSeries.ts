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
  "Unallocated",
  "Customer Support",
  "Marketing",
] as const;

/**
 * The last `days` calendar days ending today, as ISO day strings. Callers hold
 * this in a `useMemo` so the window is read from the clock once per render
 * pass rather than once per series.
 */
export function recentDays(days: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    out.push(d.toISOString().slice(0, 10));
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

/** Daily buckets with one stacked segment per label. */
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
 * Consumption split into the part already spent and the part still projected,
 * so the forecast panel can paint the run-rate tail in a lighter shade. The
 * last quarter of the window is the projection.
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
