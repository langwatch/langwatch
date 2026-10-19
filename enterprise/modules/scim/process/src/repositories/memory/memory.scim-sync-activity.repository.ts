// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { ScimSyncActivityEntry } from "@langwatch/enterprise-scim-contract";

import { ScimSyncActivityRepository } from "../scim-sync-activity.repository.ts";

/** The sync log's twin: entries held per connection, newest first, keyed `organizationId:connectionId`. */
export class MemoryScimSyncActivityRepository extends ScimSyncActivityRepository {
  readonly entries = new Map<string, ScimSyncActivityEntry[]>();

  static create(): MemoryScimSyncActivityRepository {
    return new MemoryScimSyncActivityRepository();
  }

  private constructor() {
    super();
  }

  async findActivity({
    organizationId,
    connectionId,
    limit,
  }: {
    organizationId: string;
    connectionId: string;
    limit: number;
  }): Promise<readonly ScimSyncActivityEntry[]> {
    return (this.entries.get(`${organizationId}:${connectionId}`) ?? []).slice(0, limit);
  }
}
