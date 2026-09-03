/**
 * Composes the run dialog's configuration history from ClickHouse, the way
 * the process root is meant to reach it: repositories stay private, the
 * caller receives only the canonical service.
 */
import { RunConfigurationsService } from "../services/run-configurations.service";
import { RunConfigurationsClickHouseRepository } from "../repositories/clickhouse/clickhouse.run-configurations.repository";
import { PrismaScenarioRepository } from "../repositories/prisma/scenario.repository";
import { RunConfigurationsReadPort } from "../ports/run-configurations-read.port";
import type { ResultAtomsClickHouseClient } from "./result-atoms.clickhouse.adapter";

/** The run dialog's configuration history, refused by name for the same reason. */
class UnavailableRunConfigurationsRepository extends RunConfigurationsReadPort {
  findConfigurations(): ReturnType<RunConfigurationsReadPort["findConfigurations"]> {
    return Promise.reject(
      new Error("Run configuration history has no ClickHouse endpoint on this deployment"),
    );
  }
}

export class RunConfigurationsClickHouseAdapter {
  static create(input: {
    resolveClient: (tenantId: string) => Promise<ResultAtomsClickHouseClient>;
    prisma: Parameters<typeof PrismaScenarioRepository.create>[0];
  }): RunConfigurationsService {
    return RunConfigurationsService.create(
      RunConfigurationsClickHouseRepository.create(input.resolveClient),
      PrismaScenarioRepository.create(input.prisma),
    );
  }

  static createUnavailable(input: {
    prisma: Parameters<typeof PrismaScenarioRepository.create>[0];
  }): RunConfigurationsService {
    return RunConfigurationsService.create(
      new UnavailableRunConfigurationsRepository(),
      PrismaScenarioRepository.create(input.prisma),
    );
  }
}
