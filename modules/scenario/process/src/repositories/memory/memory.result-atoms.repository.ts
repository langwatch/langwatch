import { ResultAtomsRepository } from "../result-atoms.repository.ts";

/**
 * The Results tab reads, refused by name rather than answered empty: unlike
 * a run list, the stat strip is how an operator tells "no data" apart from
 * "no ClickHouse endpoint", so a deployment without one gets a clear failure.
 */
export class MemoryResultAtomsRepository extends ResultAtomsRepository {
  static create(): MemoryResultAtomsRepository {
    return new MemoryResultAtomsRepository();
  }

  private constructor() {
    super();
  }

  private refuse<T>(): Promise<T> {
    return Promise.reject(new Error("Results tab has no ClickHouse endpoint on this deployment"));
  }
  listAtoms(): ReturnType<ResultAtomsRepository["listAtoms"]> {
    return this.refuse();
  }
  findRunOrdinals(): ReturnType<ResultAtomsRepository["findRunOrdinals"]> {
    return this.refuse();
  }
  aggregateTotals(): ReturnType<ResultAtomsRepository["aggregateTotals"]> {
    return this.refuse();
  }
  // An arrow instance property, not a prototype method: the abstract base
  // declares it as a property member (a test mock reads it unbound), and a
  // class member's kind must match its base across `extends`.
  aggregateGroups = (): ReturnType<ResultAtomsRepository["aggregateGroups"]> => {
    return this.refuse();
  };
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
