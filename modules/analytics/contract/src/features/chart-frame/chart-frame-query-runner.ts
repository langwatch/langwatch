/**
 * The fetch policy behind `LW.useChartQuery`: a failed refetch keeps the last
 * good rows, a retryable failure is retried with backoff and jitter. Each
 * function is SELF-CONTAINED and in plain syntax: the shim embeds `.toString()`.
 */

/** What the hook renders from. `refetchError` is a failed refresh over kept data. */
export interface ChartQueryState {
  status: "pending" | "success" | "error";
  data: unknown;
  error: unknown;
  refetchError: unknown;
  isFetching: boolean;
}

export type ChartQueryEvent =
  | { type: "fetching" }
  | { type: "rows"; rows: unknown }
  | { type: "failed"; error: unknown };

/**
 * The next state. A failure over rows already loaded keeps them and their
 * `success` status, reporting itself as `refetchError`; only a query that
 * never had data becomes an `error`.
 */
export function reduceChartQueryState({
  previous,
  event,
}: {
  previous: ChartQueryState;
  event: ChartQueryEvent;
}): ChartQueryState {
  if (event.type === "fetching") return Object.assign({}, previous, { isFetching: true });
  if (event.type === "rows") {
    return {
      status: "success",
      data: event.rows,
      error: null,
      refetchError: null,
      isFetching: false,
    };
  }
  if (previous.status === "success") {
    return Object.assign({}, previous, { refetchError: event.error, isFetching: false });
  }
  return { status: "error", data: null, error: event.error, refetchError: null, isFetching: false };
}

export type ChartQueryRetryPlan = { retry: true; delayMs: number } | { retry: false };

/**
 * Whether to try again, and after how long: only a rejection marked retryable,
 * at most three times. Half the exponential ceiling plus jitter, so widgets
 * refused together do not return together.
 */
export function planChartQueryRetry({
  rejection,
  retriesUsed,
  random,
}: {
  rejection: unknown;
  retriesUsed: number;
  /** Uniform in [0, 1). */
  random: () => number;
}): ChartQueryRetryPlan {
  const retryable =
    typeof rejection === "object" &&
    rejection !== null &&
    (rejection as { retryable?: unknown }).retryable === true;
  if (!retryable || retriesUsed >= 3) return { retry: false };
  const ceiling = Math.min(5000, 400 * Math.pow(2, retriesUsed));
  return { retry: true, delayMs: Math.round(ceiling * (0.5 + random() * 0.5)) };
}

export interface ChartQueryRunnerOptions {
  /** One attempt at the query. */
  query: () => Promise<{ rows: unknown }>;
  emit: (event: ChartQueryEvent) => void;
  /** Shapes a rejection into what the widget reads as an error. */
  toError: (rejection: unknown) => unknown;
  planRetry: (args: { rejection: unknown; retriesUsed: number }) => ChartQueryRetryPlan;
  setTimer: (callback: () => void, delayMs: number) => unknown;
  clearTimer: (timer: unknown) => void;
}

export interface ChartQueryRunner {
  /** Starts a fetch; one already under way (or waiting to retry) is superseded. */
  run: () => void;
  /** Drops everything in flight; nothing is emitted afterwards. */
  cancel: () => void;
}

export function createChartQueryRunner(options: ChartQueryRunnerOptions): ChartQueryRunner {
  let generation = 0;
  let timer: unknown = null;

  const supersede = (): void => {
    generation += 1;
    if (timer !== null) options.clearTimer(timer);
    timer = null;
  };

  const attempt = (mine: number, retriesUsed: number): Promise<void> =>
    options.query().then(
      (result) => {
        if (mine === generation) options.emit({ type: "rows", rows: result.rows });
      },
      (rejection: unknown) => {
        if (mine !== generation) return;
        const plan = options.planRetry({ rejection: rejection, retriesUsed: retriesUsed });
        if (!plan.retry) {
          options.emit({ type: "failed", error: options.toError(rejection) });
          return;
        }
        // A superseded wait is cleared, so this only fires for the live fetch.
        timer = options.setTimer(() => {
          timer = null;
          void attempt(mine, retriesUsed + 1);
        }, plan.delayMs);
      },
    );

  return {
    run: () => {
      supersede();
      options.emit({ type: "fetching" });
      void attempt(generation, 0);
    },
    cancel: supersede,
  };
}
