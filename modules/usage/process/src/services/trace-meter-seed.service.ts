import { createLogger, type Logger } from "@langwatch/observability";
import { Temporal } from "@langwatch/time";

import type { TraceMeterRepository } from "../repositories/trace-meter.repository.ts";
import { UsageCountingService } from "./usage-counting.service.ts";

const defaultLogger = createLogger("langwatch:usage:traceMeterSeed");

/** What one seed run folded, month by month; a dry run reports what it would fold. */
export type TraceMeterSeedSummary = Readonly<{
  dryRun: boolean;
  months: readonly { month: string; traces: number }[];
}>;

/**
 * Seeds the trace meter from usage's own billable events (Q14, Alex 2026-10-06): last month and
 * this month, so the first-month rule sees traces that began before the meter. Re-running is
 * harmless: the meter keeps one row per trace and month, and the read counts each trace once.
 */
export class TraceMeterSeedService {
  private constructor(
    private readonly meter: TraceMeterRepository,
    private readonly now: () => number,
    private readonly logger: Pick<Logger, "info">,
  ) {}

  static create({
    meter,
    now = Date.now,
    logger = defaultLogger,
  }: {
    meter: TraceMeterRepository;
    now?: () => number;
    logger?: Pick<Logger, "info">;
  }): TraceMeterSeedService {
    return new TraceMeterSeedService(meter, now, logger);
  }

  async run({ dryRun }: { dryRun: boolean }): Promise<TraceMeterSeedSummary> {
    const current = Temporal.PlainYearMonth.from(UsageCountingService.monthOf(this.now()));
    const months = [];
    for (const month of [current.subtract({ months: 1 }).toString(), current.toString()]) {
      months.push({ month, traces: await this.meter.seedMonth({ month, dryRun }) });
    }
    const summary = { dryRun, months };
    this.logger.info(summary, dryRun ? "trace meter seed dry run" : "trace meter seeded");
    return summary;
  }
}
