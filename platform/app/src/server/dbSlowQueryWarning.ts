import { createLogger } from "@langwatch/observability";
import { createWarnThrottle } from "./observability/warnThrottle";

/**
 * Warns when a Postgres operation takes longer than its budget.
 *
 * A query that succeeds slowly leaves the same record as one that succeeds
 * instantly, so it stays invisible until someone reports that a screen feels
 * broken. This raises that one case to a warning: the work completed and the
 * answer was correct, so it is not an error, but the rate of it is worth
 * watching.
 *
 * The throttle is the substantive part. ClickHouse had a per-query warning and
 * it was removed in #6114 for flooding the logs, because a query that has
 * become slow is slow on every call and there is no useful signal in the
 * fiftieth identical line. Each (model, operation) pair warns at most once per
 * interval and the next warning states how many calls it stood for, so a
 * permanently slow query costs one line a minute instead of one per call.
 *
 * @see specs/observability/slow-work-warnings.feature
 */

const logger = createLogger("langwatch:postgres:query");

const DEFAULT_SLOW_QUERY_MS = 500;
const DEFAULT_THROTTLE_MS = 60_000;

const RAW_ACTIONS = new Set(["queryRaw", "executeRaw"]);

/**
 * Reads the budget from the environment. Zero or negative turns the warning
 * off entirely, which is the escape hatch for a deployment that decides the
 * lines are not worth it; an unset or unparseable value keeps the default.
 */
export function resolveSlowQueryBudgetMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.POSTGRES_SLOW_QUERY_MS;
  if (typeof raw !== "string" || raw.trim() === "") {
    return DEFAULT_SLOW_QUERY_MS;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_SLOW_QUERY_MS;
}

/**
 * The argument keys say what shape the query was without saying what was in
 * it. The values hold customer data (identifiers, names, message bodies), and
 * a raw operation's arguments hold the SQL text and its parameters, so raw
 * operations report no keys at all. Same rule the ClickHouse client follows
 * with `paramKeys`.
 */
export function safeArgKeys({
  action,
  args,
}: {
  action: string;
  args: unknown;
}): string[] | undefined {
  if (RAW_ACTIONS.has(action)) return undefined;
  if (!args || typeof args !== "object" || Array.isArray(args))
    return undefined;
  return Object.keys(args as Record<string, unknown>);
}

const throttle = createWarnThrottle(DEFAULT_THROTTLE_MS);

/** Test seam: the throttle is process-wide state and must not leak between tests. */
export function resetSlowQueryThrottle(): void {
  throttle.reset();
}

/**
 * Reports one completed Postgres operation. Fast operations cost a comparison
 * and nothing else.
 */
export function reportQueryDuration({
  model,
  action,
  args,
  durationMs,
  budgetMs = resolveSlowQueryBudgetMs(),
  now = Date.now(),
}: {
  model?: string;
  action: string;
  args: unknown;
  durationMs: number;
  budgetMs?: number;
  now?: number;
}): void {
  if (budgetMs <= 0 || durationMs <= budgetMs) return;

  try {
    const key = `${model ?? "-"}.${action}`;
    const suppressed = throttle.claim({ key, now });
    if (suppressed === undefined) return;

    logger.warn(
      {
        source: "postgres",
        model,
        operation: action,
        durationMs: Math.round(durationMs),
        budgetMs,
        argKeys: safeArgKeys({ action, args }),
        // Reads as zero on the first warning, which is the honest answer: it
        // stands for itself alone.
        suppressedSincePrevious: suppressed,
      },
      `Postgres slow query: ${key} took ${Math.round(durationMs)}ms (budget ${budgetMs}ms)`,
    );
  } catch (loggingError) {
    logger.error({ loggingError }, "Failed to log Postgres slow query");
  }
}

/**
 * Times one Postgres operation and reports it.
 *
 * A rejection is re-raised untimed and unreported: it reaches the caller,
 * which logs it with the cause attached, and a slow warning on top would
 * describe the same event a second time under a level that disagrees.
 */
export async function withQueryTiming<T>({
  params,
  run,
}: {
  params: { model?: string; action: string; args: unknown };
  run: () => Promise<T>;
}): Promise<T> {
  const startedAt = performance.now();
  const result = await run();
  reportQueryDuration({ ...params, durationMs: performance.now() - startedAt });
  return result;
}
