/**
 * Composes the Results tab's service from ClickHouse, the way the process
 * root is meant to reach it: repositories stay private, the caller receives
 * only the canonical service.
 */
import { ResultAtomsService } from "../services/result-atoms.service";
import { ResultAtomsClickHouseRepository } from "../repositories/clickhouse/clickhouse.result-atoms.repository";
import { PrismaScenarioRepository } from "../repositories/prisma/scenario.repository";
import { ResultAtomsReadPort } from "../ports/result-atoms-read.port";

/**
 * The narrow slice of `@clickhouse/client`'s `ClickHouseClient` this feature reads through. Duck-
 * typed rather than the real class so the composition root can hand it the same routed-tenant
 * client the v1 simulation reads already compose (`SimulationReadClient`), with no cast.
 */
export type ResultAtomsClickHouseClient = {
  query(input: {
    query: string;
    query_params: Record<string, string | string[]>;
    format: "JSONEachRow";
  }): Promise<{ json<Result>(): Promise<Result[]> }>;
};

/**
 * The Results tab reads, refused by name rather than answered empty: unlike
 * a run list, the stat strip is how an operator tells "no data" apart from
 * "no ClickHouse endpoint", so a deployment without one gets a clear failure.
 */
class UnavailableResultAtomsRepository extends ResultAtomsReadPort {
  private refuse<T>(): Promise<T> {
    return Promise.reject(new Error("Results tab has no ClickHouse endpoint on this deployment"));
  }
  findAtoms(): ReturnType<ResultAtomsReadPort["findAtoms"]> {
    return this.refuse();
  }
  findRunOrdinals(): ReturnType<ResultAtomsReadPort["findRunOrdinals"]> {
    return this.refuse();
  }
  tryAggregateTotals(): ReturnType<ResultAtomsReadPort["tryAggregateTotals"]> {
    return this.refuse();
  }
  aggregateGroups(): ReturnType<ResultAtomsReadPort["aggregateGroups"]> {
    return this.refuse();
  }
  findCodeScenarios(): ReturnType<ResultAtomsReadPort["findCodeScenarios"]> {
    return this.refuse();
  }
  findRunTargets(): ReturnType<ResultAtomsReadPort["findRunTargets"]> {
    return this.refuse();
  }
  aggregateTrend(): ReturnType<ResultAtomsReadPort["aggregateTrend"]> {
    return this.refuse();
  }
  aggregateSeries(): ReturnType<ResultAtomsReadPort["aggregateSeries"]> {
    return this.refuse();
  }
}

export class ResultAtomsClickHouseAdapter {
  static create(input: {
    resolveClient: (tenantId: string) => Promise<ResultAtomsClickHouseClient>;
    prisma: Parameters<typeof PrismaScenarioRepository.create>[0];
  }): ResultAtomsService {
    return ResultAtomsService.create(
      ResultAtomsClickHouseRepository.create(input.resolveClient),
      PrismaScenarioRepository.create(input.prisma),
    );
  }

  static createUnavailable(input: {
    prisma: Parameters<typeof PrismaScenarioRepository.create>[0];
  }): ResultAtomsService {
    return ResultAtomsService.create(
      new UnavailableResultAtomsRepository(),
      PrismaScenarioRepository.create(input.prisma),
    );
  }
}
