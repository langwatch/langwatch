import { ExperimentIdLookupRepository } from "../experiment-id-lookup.repository";

/** No-op lookup for deployments without ClickHouse. */
export class MemoryExperimentIdLookupRepository extends ExperimentIdLookupRepository {
  static create(): MemoryExperimentIdLookupRepository {
    return new MemoryExperimentIdLookupRepository();
  }

  // Parameter declared though unused: a caller holding this type still passes
  // it, and a zero-arity signature makes that a type error even though it
  // satisfies the interface.
  async findExperimentId(_input: { tenantId: string; runId: string }): Promise<string | null> {
    return null;
  }
}
