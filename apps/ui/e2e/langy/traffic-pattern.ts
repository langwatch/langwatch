/**
 * Now-relative traffic for the dashboards and insights scenarios: what to seed,
 * and the totals a widget or a finding must reproduce. Pure, so the per-day
 * counts are unit-tested without a stack.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** A half-open `[start, end)` in epoch milliseconds. */
export interface TimeWindow {
  start: number;
  end: number;
}

/**
 * The last full UTC day before `now` and the day before it. UTC midnight only:
 * this matches `dailyRunWindows` in modules/insight only while that fixes UTC too.
 */
export function dailyWindows(now: number): { day: TimeWindow; previous: TimeWindow } {
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  return {
    day: { start: today - DAY_MS, end: today },
    previous: { start: today - 2 * DAY_MS, end: today - DAY_MS },
  };
}

/** What to seed. The baseline alone is the flat (quiet day) pattern. */
export interface TrafficPlan {
  /** Traces in every UTC hour of both days. */
  perHour: number;
  /** Extra traces in one UTC hour (0 to 23) of the last full day. */
  spike?: { hour: number; extra: number };
  /** Text appended to the input of every trace on the last full day. */
  injection?: string;
}

/** One trace to send: its timing and text, and the ids of its two model calls. */
export interface PlannedTrace {
  traceId: string;
  /** Two LLM spans per trace, so a span or model-call count never equals the trace count. */
  spanIds: [string, string];
  startedAt: number;
  durationMs: number;
  input: string;
  output: string;
}

/** The totals a correct chart or finding reports for a plan. */
export function expectedTotals(plan: TrafficPlan): {
  previousDay: number;
  day: number;
  spikeHour: number;
} {
  const extra = plan.spike?.extra ?? 0;
  return {
    previousDay: plan.perHour * 24,
    day: plan.perHour * 24 + extra,
    spikeHour: plan.perHour + extra,
  };
}

/** Every trace of a plan, spread evenly inside each hour so none sits on a boundary. */
export function planTraffic({
  now,
  plan,
  runId,
}: {
  now: number;
  plan: TrafficPlan;
  /** Keeps two seeds in one project from colliding on trace ids. */
  runId: string;
}): PlannedTrace[] {
  validatePlan(plan);
  const { day, previous } = dailyWindows(now);
  const traces: PlannedTrace[] = [];
  for (const [label, window] of [
    ["previous", previous],
    ["day", day],
  ] as const) {
    for (let hour = 0; hour < 24; hour++) {
      const spiked = label === "day" && plan.spike?.hour === hour;
      const count = plan.perHour + (spiked ? (plan.spike?.extra ?? 0) : 0);
      const hourStart = window.start + hour * HOUR_MS;
      for (let i = 0; i < count; i++) {
        const order = traces.length;
        const question = `customer support question #${order}: where is my order?`;
        traces.push({
          traceId: `trace_e2e_${runId}_${label}_${hour}_${i}`,
          spanIds: [
            `span_e2e_${runId}_${label}_${hour}_${i}_lookup`,
            `span_e2e_${runId}_${label}_${hour}_${i}_answer`,
          ],
          startedAt: hourStart + Math.floor(((i + 0.5) * HOUR_MS) / count),
          // 0.8s to 9.6s, so latency charts have a real spread.
          durationMs: 800 + (order % 9) * 1_100,
          input: label === "day" && plan.injection ? `${question}\n\n${plan.injection}` : question,
          output: `Your order #10${order} is out for delivery.`,
        });
      }
    }
  }
  return traces;
}

function validatePlan(plan: TrafficPlan): void {
  if (!Number.isInteger(plan.perHour) || plan.perHour < 1) {
    throw new Error(`perHour must be a positive integer, got ${plan.perHour}`);
  }
  if (plan.spike) {
    const { hour, extra } = plan.spike;
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      throw new Error(`spike.hour must be a UTC hour from 0 to 23, got ${hour}`);
    }
    if (!Number.isInteger(extra) || extra < 1) {
      throw new Error(`spike.extra must be a positive integer, got ${extra}`);
    }
  }
}
