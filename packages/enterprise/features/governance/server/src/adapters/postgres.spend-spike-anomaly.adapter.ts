import type { GovernanceDiagnosticsPort } from "../ports/governance-diagnostics.port";
import type { AnomalySpendReaderPort } from "../ports/spend-spike-anomaly.port";
import { PrismaSpendSpikeAnomalyRepository } from "../repositories/prisma/prisma.spend-spike-anomaly.repository";
import type { AnomalyAlertDispatcherService } from "../services/anomaly-alert-dispatcher.service";
import { SpendSpikeAnomalyEvaluatorService } from "../services/spend-spike-anomaly-evaluator.service";

export class PostgresSpendSpikeAnomalyAdapter {
  private constructor(
    private readonly database: object,
    private readonly spend: AnomalySpendReaderPort | undefined,
    private readonly dispatcher: AnomalyAlertDispatcherService,
    private readonly diagnostics: GovernanceDiagnosticsPort | undefined,
  ) {}

  static create(options: {
    database: object;
    spend?: AnomalySpendReaderPort;
    dispatcher: AnomalyAlertDispatcherService;
    diagnostics?: GovernanceDiagnosticsPort;
  }): PostgresSpendSpikeAnomalyAdapter {
    return new PostgresSpendSpikeAnomalyAdapter(
      options.database,
      options.spend,
      options.dispatcher,
      options.diagnostics,
    );
  }

  build(): SpendSpikeAnomalyEvaluatorService {
    return SpendSpikeAnomalyEvaluatorService.create({
      repository: PrismaSpendSpikeAnomalyRepository.create(this.database),
      spend: this.spend,
      dispatcher: this.dispatcher,
      diagnostics: this.diagnostics,
    });
  }
}
