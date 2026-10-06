import type { PRODUCTION_STORAGE_METER_TABLES } from "@langwatch/data-retention-contract/retention-tables";

/** One table the storage meter measures. */
export type StorageMeterTable = (typeof PRODUCTION_STORAGE_METER_TABLES)[number];

/** The bytes a tenant holds on disk; a store that cannot answer throws. */
export interface StorageMeterRepository {
  /** Every metered table's bytes for the tenant, summed in one read. */
  getTenantBytes(input: { tenantId: string }): Promise<number>;
  /** One metered table's bytes for the tenant. */
  getTableBytes(input: { tenantId: string; table: StorageMeterTable }): Promise<number>;
}
