import { ResultAtomsRepository } from "../clickhouse/clickhouse.result-atoms.repository.ts";

/**
 * The Results tab reads, refused by name rather than answered empty: unlike
 * a run list, the stat strip is how an operator tells "no data" apart from
 * "no ClickHouse endpoint", so a deployment without one gets a clear failure.
 */
export class MemoryResultAtomsRepository extends ResultAtomsRepository {
  private refuse<T>(): Promise<T> {
    return Promise.reject(new Error("Results tab has no ClickHouse endpoint on this deployment"));
  }
  findAtoms(): ReturnType<ResultAtomsRepository["findAtoms"]> {
    return this.refuse();
  }
  findRunOrdinals(): ReturnType<ResultAtomsRepository["findRunOrdinals"]> {
    return this.refuse();
  }
  tryAggregateTotals(): ReturnType<ResultAtomsRepository["tryAggregateTotals"]> {
    return this.refuse();
  }
  aggregateGroups(): ReturnType<ResultAtomsRepository["aggregateGroups"]> {
    return this.refuse();
  }
  findCodeScenarios(): ReturnType<ResultAtomsRepository["findCodeScenarios"]> {
    return this.refuse();
  }
  findRunTargets(): ReturnType<ResultAtomsRepository["findRunTargets"]> {
    return this.refuse();
  }
  aggregateTrend(): ReturnType<ResultAtomsRepository["aggregateTrend"]> {
    return this.refuse();
  }
  aggregateSeries(): ReturnType<ResultAtomsRepository["aggregateSeries"]> {
    return this.refuse();
  }
}
