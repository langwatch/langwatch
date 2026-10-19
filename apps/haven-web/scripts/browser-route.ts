// `haven browser route`: a lane's requests matching a glob are answered with a fault
// instead of reaching the stack, so a page's failure and retry paths can be walked.

/** One rule: answer `status` for the next `times` matches (every match when unset). */
export type RouteRule = {
  pattern: string;
  status: number;
  times?: number;
  hits: number;
};

/** A rule as `route add` builds it, refusing a status no response can carry. */
export function routeRule({
  pattern,
  status,
  times,
}: {
  pattern: string;
  status?: number;
  times?: number;
}): RouteRule {
  if (!pattern) throw new Error("route add needs <pattern>, a URL glob such as **/api/trpc/**");
  const code = status ?? 503;
  if (!Number.isInteger(code) || code < 100 || code > 599)
    throw new Error(`--status ${code} is not an HTTP status`);
  if (times !== undefined && (!Number.isInteger(times) || times < 1))
    throw new Error(`--times ${times} is not a positive number`);
  return { pattern, status: code, ...(times !== undefined && { times }), hits: 0 };
}

/** Whether this match is faulted; counts it when it is. A spent rule lets requests through. */
export function takeFault({ rule }: { rule: RouteRule }): boolean {
  if (rule.times !== undefined && rule.hits >= rule.times) return false;
  rule.hits += 1;
  return true;
}

/** The body a faulted request answers, shaped like the app's own error replies. */
export function faultBody({ rule }: { rule: RouteRule }): string {
  return JSON.stringify({
    error: { message: `haven browser route: forced ${rule.status}`, code: "haven_route_fault" },
  });
}
