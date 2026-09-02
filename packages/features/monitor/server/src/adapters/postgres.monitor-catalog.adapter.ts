import {
  PrismaMonitorRepository,
  type MonitorDatabase,
} from "../repositories/prisma/prisma.monitor.repository";
import { MonitorCatalogService } from "../services/monitor-catalog.service";

/** The one model the monitor listing needs from the client. */
export type MonitorCatalogDatabase = MonitorDatabase;

/**
 * The monitor listing trace ingestion reads, composed from one Prisma client
 * and nothing else.
 *
 * A background process that folds spans has to ask, once per trace, which of a
 * project's monitors run on every message. Reaching that through
 * `MonitorService` meant composing an `EvaluatorService` — the evaluator
 * repository, its catalog and the id service behind it — for a read that does
 * not name an evaluator at all.
 *
 * The object it builds satisfies Trace's `TraceEvaluationMonitorPort`.
 * `MonitorService` satisfies it as well, because it composes this same service
 * and delegates to it, which is what keeps the application's own compositions
 * compiling unchanged and what keeps the two processes answering from one
 * implementation rather than two.
 */
export class PostgresMonitorCatalogAdapter {
  static create(options: { database: MonitorCatalogDatabase }): PostgresMonitorCatalogAdapter {
    return new PostgresMonitorCatalogAdapter(options.database);
  }

  private constructor(private readonly database: MonitorCatalogDatabase) {}

  build(): MonitorCatalogService {
    return MonitorCatalogService.create({
      repository: PrismaMonitorRepository.create(this.database),
    });
  }
}
