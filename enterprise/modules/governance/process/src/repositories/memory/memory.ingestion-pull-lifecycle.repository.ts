// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  IngestionPullLifecycleRepository,
  type IngestionPullLifecycleSource,
} from "../ingestion-pull-lifecycle.repository.ts";

/** The sources a reconciliation walks, in memory: every one a test seeded. */
export class MemoryIngestionPullLifecycleRepository extends IngestionPullLifecycleRepository {
  private readonly sources = new Map<string, IngestionPullLifecycleSource>();

  private constructor() {
    super();
  }

  static create({
    seed = [],
  }: {
    seed?: readonly IngestionPullLifecycleSource[];
  } = {}): MemoryIngestionPullLifecycleRepository {
    const repository = new MemoryIngestionPullLifecycleRepository();
    for (const source of seed) repository.sources.set(source.id, source);
    return repository;
  }

  async findForReconciliation(): Promise<IngestionPullLifecycleSource[]> {
    return [...this.sources.values()];
  }
}
