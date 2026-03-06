import type { SuiteRunItemData } from "../projections/suiteRunItems.foldProjection";
import type { SuiteRunItemsRepository } from "./suiteRunItems.repository";

export class SuiteRunItemsRepositoryMemory implements SuiteRunItemsRepository {
  private readonly store = new Map<string, SuiteRunItemData[]>();

  private getKey(tenantId: string, suiteId: string, batchRunId: string): string {
    return `${tenantId}:${suiteId}:${batchRunId}`;
  }

  async getItems(params: {
    tenantId: string;
    suiteId: string;
    batchRunId: string;
  }): Promise<SuiteRunItemData[]> {
    const key = this.getKey(params.tenantId, params.suiteId, params.batchRunId);
    return this.store.get(key) ?? [];
  }

  async storeItems(params: {
    tenantId: string;
    suiteId: string;
    batchRunId: string;
    projectionId: string;
    items: SuiteRunItemData[];
  }): Promise<void> {
    const key = this.getKey(params.tenantId, params.suiteId, params.batchRunId);
    this.store.set(key, params.items);
  }
}
