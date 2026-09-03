import { PrismaAnomalyRuleRepository } from "../repositories/prisma/prisma.anomaly-rule.repository";
import { AnomalyRuleService } from "../services/anomaly-rule.service";

export class PostgresAnomalyRuleAdapter {
  private constructor(
    private readonly database: object,
    private readonly now: (() => Date) | undefined,
  ) {}

  static create(options: { database: object; now?: () => Date }): PostgresAnomalyRuleAdapter {
    return new PostgresAnomalyRuleAdapter(options.database, options.now);
  }

  build(): AnomalyRuleService {
    return AnomalyRuleService.create({
      repository: PrismaAnomalyRuleRepository.create(this.database),
      now: this.now,
    });
  }
}
