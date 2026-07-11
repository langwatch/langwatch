/**
 * Turn a 7-day trace-match count into a rough firing-rate phrase for a trace
 * automation, which fires once per matching trace. Picks the coarsest unit that
 * reads naturally — per hour for busy queries, per day, else per week — so the
 * author gets a feel for volume before wiring up a Slack ping or dataset write.
 *
 * Alerts (graph-threshold) fire on breaches, not per-trace, so this estimate
 * deliberately covers only the trace-subject (Automate) path.
 */
export function estimateFiringRate(matchesLast7Days: number): string {
  const perDay = matchesLast7Days / 7;
  if (perDay >= 24) {
    const n = Math.round(perDay / 24);
    return `About ${n} ${n === 1 ? "time" : "times"} an hour at this rate`;
  }
  if (perDay >= 1) {
    const n = Math.round(perDay);
    return `About ${n} ${n === 1 ? "time" : "times"} a day at this rate`;
  }
  const n = matchesLast7Days;
  return `About ${n} ${n === 1 ? "time" : "times"} a week at this rate`;
}
