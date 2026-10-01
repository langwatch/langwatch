import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";

const logger = createLogger("langwatch:automation:report-schedule-backfill");

/** The one operation the backfill needs from the booted automation app. */
type ReportScheduleReconciler = {
  reconcileReportSchedules(): Promise<{ repaired: number }>;
};

/** Configures a schedule process for every active report that has none (the ScheduledJob move). */
export class ReportScheduleBackfillTask extends Task {
  readonly name = "report-schedule-backfill";
  readonly description =
    "Gives every active report automation its schedule process; reports already scheduled are left alone.";

  private constructor(private readonly reports: ReportScheduleReconciler) {
    super();
  }

  static create(reports: ReportScheduleReconciler): ReportScheduleBackfillTask {
    return new ReportScheduleBackfillTask(reports);
  }

  async run(): Promise<void> {
    const { repaired } = await this.reports.reconcileReportSchedules();
    logger.info({ repaired }, "Report schedules backfilled");
  }
}
