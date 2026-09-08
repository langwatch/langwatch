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

/**
 * The section's agent names, spelled bare.
 *
 * NO ENVIRONMENT SUFFIX. ADR-128 keys an agent on name AND environment, so
 * "checkout-agent-prod" is two fields glued into one string: a reader who saw
 * that name here and went looking for it on the Agents screen would not find
 * it, because the agent there is called "checkout-agent" and runs in
 * production. If a cost row ever needs to say where an agent ran, it gets an
 * environment badge of its own, the way Agents does — never a longer name.
 *
 * This list is a subset of the section's canonical roster and every entry has
 * to stay one, including the two nothing renders today: `slice(0, 6)` on the
 * consumer side is a slice, not a boundary, and widening it must not be able
 * to surface a name the Agents screen has never heard of.
 */
export const SAMPLE_AGENTS = [
  "support-copilot",
  "checkout-agent",
  "fraud-triage",
  "churn-predictor",
  "docs-rag",
  "genie-revenue-analyst",
  "genie-supply-planner",
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

/** The `count` months after `day`, as ISO first-of-month days. */
export function monthsAfter(day: string, count: number): string[] {
  const start = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return [];
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    out.push(
      new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1))
        .toISOString()
        .slice(0, 10),
    );
  }
  return out;
}

/** How many trailing periods the run rate is taken from. */
const RUN_RATE_PERIODS = 3;
/** What the run rate is assumed to do each month it is carried forward. */
const PROJECTED_DRIFT = 1.02;
/** How far ahead the panel forecasts when the caller does not say: a quarter. */
const MONTHS_PROJECTED_AHEAD = 3;

/**
 * Metered spend already served, and the months still to come.
 *
 * A FORECAST POINTS FORWARD. This used to shade the last quarter of the window
 * itself, which meant the panel called "forecast" projected nothing: every
 * month it drew had already happened, and the only thing the shading said was
 * that we had stopped trusting our own measurements three months back. The
 * projected months are now months the window does not contain — they come
 * after its last day, and the chart's axis runs past today because that is
 * what a forecast is.
 *
 * The projected values are a run rate carried forward, not another roll of the
 * generator. Measured spend is noisy because serving traffic is noisy; a
 * projection is an average with an assumption on it, and drawing it with the
 * same jitter as the measured months would claim we can forecast next month's
 * wobble. So the tail leaves from the mean of the last three measured months
 * and drifts gently.
 *
 * `measured` and `projected` are returned apart because the ranked panels are
 * totalled from this series, and money nobody has spent must never be counted
 * as spend. The chart concatenates them; the totals take `measured` alone.
 *
 * `monthsAhead` exists because the projection has to survive the fold. The
 * chart's buckets are whatever interval the reader picked, and a three-month
 * projection folded to a YEAR lands inside the same bucket as nine measured
 * months — one bar silently holding spend and forecast together, which is the
 * one thing this panel must never do. The caller therefore reaches at least a
 * bucket ahead, so the projected months always have a bucket of their own.
 *
 * An options object rather than four positional arguments: three of these are
 * numbers and strings that would read identically in the wrong order.
 */
export function sampleForecast({
  days,
  labels,
  monthlyTopValue,
  monthsAhead = MONTHS_PROJECTED_AHEAD,
}: {
  days: string[];
  labels: readonly string[];
  monthlyTopValue: number;
  monthsAhead?: number;
}): {
  measured: DailyBucket[];
  projected: DailyBucket[];
  projectedFromDay: string | null;
} {
  const measured = sampleDaily(days, labels, monthlyTopValue);
  const lastDay = days[days.length - 1];
  if (!lastDay) return { measured, projected: [], projectedFromDay: null };

  const tail = measured.slice(-RUN_RATE_PERIODS);
  const runRate = new Map(
    labels.map((label) => {
      const values = tail.map(
        (bucket) => bucket.points.find((p) => p.key === label)?.value ?? 0,
      );
      const total = values.reduce((sum, value) => sum + value, 0);
      return [label, values.length === 0 ? 0 : total / values.length];
    }),
  );

  const ahead = monthsAfter(lastDay, monthsAhead);
  const projected = ahead.map((day, index) => ({
    day,
    points: labels.map((label) => ({
      key: label,
      label,
      value: Math.round((runRate.get(label) ?? 0) * PROJECTED_DRIFT ** index),
    })),
  }));

  return { measured, projected, projectedFromDay: ahead[0] ?? null };
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
): DailyBucket[] {
  return periods.map((day) => {
    const counts = sampleSeatPools(day, pools);
    const total = (pick: (pool: SampleSeatPool) => number) =>
      counts.reduce((sum, pool) => sum + pick(pool), 0);
    return {
      day,
      points: [
        {
          key: "bought",
          label: "Seats bought",
          value: total((pool) => pool.seatsBought),
        },
        {
          key: "assigned",
          label: "Seats assigned",
          value: total((pool) => pool.seatsAssigned),
        },
      ],
    };
  });
}

/** One licence pool's counts at a point in time. */
export interface SampleSeatPool {
  skuPartNumber: string;
  seatsBought: number;
  seatsAssigned: number;
}

/**
 * How many seats each pool holds in a given month, and how many are sat in.
 *
 * THE SHAPE IS THE POINT. Seats are bought on a contract and assigned by
 * hand afterwards, so the two series do not move together: purchasing steps
 * up once at renewal and then holds flat for a year, while assignment starts
 * near the floor — the seats are paid for before anyone has been given one —
 * and catches up over the following quarters. The generator used to scale
 * assigned as a near-constant fraction of bought, which drew two lines rising
 * in parallel and taught the reader that idle seats are a fixed overhead. They
 * are not. They are a spike at renewal that the organization works off, and an
 * admin reading this panel is looking for exactly that.
 *
 * Renewal is January for every pool. Staggering the three would smear the step
 * across the aggregate chart, and a step nobody can see is a shape nobody
 * learns.
 *
 * Deterministic in `day` alone, so the lane card and the chart beside it can
 * both ask for the same month and cannot disagree about it.
 */
export function sampleSeatPools(
  day: string,
  pools: readonly string[] = SAMPLE_SEAT_POOLS,
): SampleSeatPool[] {
  const date = new Date(`${day}T00:00:00Z`);
  const monthsSinceRenewal = Number.isNaN(date.getTime())
    ? 0
    : date.getUTCMonth();
  const renewals = Number.isNaN(date.getTime())
    ? 0
    : date.getUTCFullYear() - SEAT_CONTRACT_EPOCH_YEAR;

  return pools.map((skuPartNumber, index) => {
    const random = seededRandom(hashLabel(skuPartNumber));
    const base = SEAT_POOL_BASE + index * 60;
    // Licences are bought in blocks, so the step lands on a round number
    // rather than wherever the growth rate happened to fall.
    const bought =
      Math.round(
        (base * (1 + SEATS_ADDED_PER_RENEWAL * Math.max(0, renewals))) / 10,
      ) * 10;
    // Saturating rather than linear: the first weeks after a renewal assign
    // most of the backlog and the last stragglers take the rest of the year.
    const progress = monthsSinceRenewal / 11;
    const eased = 1 - (1 - progress) ** 2;
    const ceiling =
      ASSIGNED_AT_RENEWAL +
      (ASSIGNED_BY_YEAR_END - ASSIGNED_AT_RENEWAL) * eased;
    // Never above bought: a provider cannot seat more people than the licences
    // paid for, and a bar that crossed would read as a defect in the read.
    const seatsAssigned = Math.min(
      bought,
      Math.round(bought * ceiling * (0.94 + random() * 0.06)),
    );
    return { skuPartNumber, seatsBought: bought, seatsAssigned };
  });
}

/** The year the invented organization signed its first seat contract. */
const SEAT_CONTRACT_EPOCH_YEAR = 2024;
/** Seats in the smallest pool at signing. The others are bigger by a step. */
const SEAT_POOL_BASE = 140;
/** How much bigger each renewal makes a pool. */
const SEATS_ADDED_PER_RENEWAL = 0.18;
/** Share of a freshly renewed pool that already has somebody in it. */
const ASSIGNED_AT_RENEWAL = 0.34;
/** Share assigned by the month before the next renewal. */
const ASSIGNED_BY_YEAR_END = 0.95;

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
