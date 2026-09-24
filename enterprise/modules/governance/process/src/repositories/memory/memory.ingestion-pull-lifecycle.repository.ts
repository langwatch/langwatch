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

  static create(): MemoryIngestionPullLifecycleRepository {
    return new MemoryIngestionPullLifecycleRepository();
  }

  seed(source: IngestionPullLifecycleSource): void {
    this.sources.set(source.id, source);
  }

  async findForReconciliation(): Promise<IngestionPullLifecycleSource[]> {
    return [...this.sources.values()];
  }
}
