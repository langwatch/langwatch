import {
  NullTraceWindowedReadMetricsPort,
  type TraceWindowedReadMetricsPort,
} from "../../ports/trace-windowed-read-metrics.port";

export const DEFAULT_PARTITION_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

type WindowFragment = {
  fromMs: number;
  toMs: number;
};

type QueryWindowedOptions<T> = {
  table: string;
  hintMs: number | null;
  windowMs?: number;
  fallback: "none" | "unbounded";
  isEmpty: (result: T) => boolean;
  run: (window: WindowFragment | null) => Promise<T>;
  metrics?: TraceWindowedReadMetricsPort;
};

export async function queryWindowed<T>(options: QueryWindowedOptions<T>): Promise<T> {
  const metrics = options.metrics ?? new NullTraceWindowedReadMetricsPort();
  const windowMs = options.windowMs ?? DEFAULT_PARTITION_WINDOW_MS;

  try {
    if (options.hintMs === null) {
      const result = await options.run(null);
      metrics.record({ table: options.table, outcome: "unwindowed" });
      return result;
    }

    const hinted = await options.run({
      fromMs: options.hintMs - windowMs,
      toMs: options.hintMs + windowMs,
    });

    if (options.fallback === "none") {
      metrics.record({
        table: options.table,
        outcome: options.isEmpty(hinted) ? "windowed_empty" : "hit",
      });
      return hinted;
    }

    if (!options.isEmpty(hinted)) {
      metrics.record({ table: options.table, outcome: "hit" });
      return hinted;
    }

    const widened = await options.run(null);
    metrics.record({
      table: options.table,
      outcome: options.isEmpty(widened) ? "unbounded_empty" : "unbounded_hit",
    });
    return widened;
  } catch (error) {
    metrics.record({ table: options.table, outcome: "error" });
    throw error;
  }
}
