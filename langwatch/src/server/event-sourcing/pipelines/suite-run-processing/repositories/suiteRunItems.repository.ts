import type { SuiteRunItemData } from "../projections/suiteRunItems.foldProjection";

export interface SuiteRunItemsRepository {
  getItems(params: {
    tenantId: string;
    suiteId: string;
    batchRunId: string;
  }): Promise<SuiteRunItemData[]>;

  storeItems(params: {
    tenantId: string;
    suiteId: string;
    batchRunId: string;
    projectionId: string;
    items: SuiteRunItemData[];
  }): Promise<void>;
}
