import {
  PulledUsageLedgerPort,
  PulledUsageLedgerProcessService,
  type PulledUsageLedgerRow,
} from "@langwatch/enterprise-governance-server";
import type { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";

export type AppPulledUsageLedgerConfig = {
  budgetCHRepository: GatewayBudgetClickHouseRepository;
};

class ClickHousePulledUsageLedgerPort extends PulledUsageLedgerPort {
  private constructor(
    private readonly repository: GatewayBudgetClickHouseRepository,
  ) {
    super();
  }

  static create(
    repository: GatewayBudgetClickHouseRepository,
  ): ClickHousePulledUsageLedgerPort {
    return new ClickHousePulledUsageLedgerPort(repository);
  }

  insert(rows: PulledUsageLedgerRow[]): Promise<void> {
    return this.repository.insertPulledUsageRows(rows);
  }
}

export type AppWritePulledUsagePayload = Parameters<
  PulledUsageLedgerProcessService["write"]
>[0];

export class AppPulledUsageLedgerService {
  private constructor(
    private readonly service: PulledUsageLedgerProcessService,
  ) {}

  static create(
    repository: GatewayBudgetClickHouseRepository,
  ): AppPulledUsageLedgerService {
    return new AppPulledUsageLedgerService(
      PulledUsageLedgerProcessService.create(
        ClickHousePulledUsageLedgerPort.create(repository),
      ),
    );
  }

  process(): PulledUsageLedgerProcessService {
    return this.service;
  }

  write(payload: AppWritePulledUsagePayload): Promise<void> {
    return this.service.write(payload);
  }
}
