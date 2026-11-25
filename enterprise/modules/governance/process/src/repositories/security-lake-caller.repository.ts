// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** One principal's model calls in Security Lake rows. */
export interface SecurityLakeCallerRow {
  principalArn: string;
  models: string[];
  regions: string[];
  lastCallMs: number;
  callCount: number;
}

export interface SecurityLakeCallerRepository {
  findSecurityLakeCallers(input: {
    tenantId: string;
    sinceMs: number;
    limit: number;
  }): Promise<SecurityLakeCallerRow[]>;
  /** The distinct events a Security Lake source wrote; an event written again counts once. */
  countSecurityLakeEvents(input: { tenantId: string; sourceId: string }): Promise<number>;
}
