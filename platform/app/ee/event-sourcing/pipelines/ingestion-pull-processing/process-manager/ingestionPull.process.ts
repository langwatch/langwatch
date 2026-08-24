import { IngestionPullSchedulePort } from "@langwatch/enterprise-governance-server";
import { computeNextRunAt } from "~/server/app-layer/scheduler/nextRunAt";

export class UtcIngestionPullSchedulePort extends IngestionPullSchedulePort {
  static create(): UtcIngestionPullSchedulePort {
    return new UtcIngestionPullSchedulePort();
  }

  nextRunAt(input: { cron: string; after: number }): number {
    return computeNextRunAt({
      cron: input.cron,
      timezone: "UTC",
      after: new Date(input.after),
    }).getTime();
  }
}
