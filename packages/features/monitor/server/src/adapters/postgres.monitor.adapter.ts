import type { EvaluatorService } from "@langwatch/evaluator-contract";
import type { MonitorService as MonitorServiceContract } from "@langwatch/monitor-contract";
import { MonitorService } from "../services/monitor.service";
import { PrismaMonitorRepository, type MonitorDatabase } from "../repositories/prisma/prisma.monitor.repository";

export type PostgresMonitorAdapterOptions = {
  database: MonitorDatabase;
  evaluators: Pick<EvaluatorService, "getById">;
  generateId?: () => string;
};

export class PostgresMonitorAdapter {
  static create(options: PostgresMonitorAdapterOptions): MonitorServiceContract {
    return MonitorService.create({
      repository: PrismaMonitorRepository.create(options.database),
      evaluators: options.evaluators,
      generateId: options.generateId,
    });
  }
}
