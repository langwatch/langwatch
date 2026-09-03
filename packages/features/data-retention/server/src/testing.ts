import { StorageMeterService } from "./services/storage-meter.service";
import type { StorageMeterClickHouseResolver } from "./ports/storage-meter-clickhouse.port";

export type StorageMeterIntegrationBreakdown = {
  totalBytes: number;
  byCategory: {
    traces: number;
    scenarios: number;
    experiments: number;
  };
};

export interface StorageMeterIntegrationHarness {
  getStorageBreakdown(input: {
    tenantId: string;
  }): Promise<StorageMeterIntegrationBreakdown>;
}

export function createStorageMeterIntegrationHarness(options: {
  resolveClickHouseClient: StorageMeterClickHouseResolver;
}): StorageMeterIntegrationHarness {
  const meter = StorageMeterService.create(options);

  return {
    getStorageBreakdown: (input) => meter.getStorageBreakdown(input),
  };
}
