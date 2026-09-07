import {
  PrismaAnomalyRuleRepository,
  type AnomalyRuleDatabase,
} from "../repositories/prisma/prisma.anomaly-rule.repository.ts";
import { AnomalyRuleService } from "../services/anomaly-rule.service.ts";

export class PostgresAnomalyRuleAdapter {
  private constructor(
    private readonly database: AnomalyRuleDatabase,
    private readonly now: (() => Date) | undefined,
  ) {}

  static create(options: {
    database: AnomalyRuleDatabase;
    now?: () => Date;
  }): PostgresAnomalyRuleAdapter {
    return new PostgresAnomalyRuleAdapter(options.database, options.now);
  }

  build(): AnomalyRuleService {
    return AnomalyRuleService.create({
      repository: PrismaAnomalyRuleRepository.create(this.database),
      now: this.now,
    });
  }
}
