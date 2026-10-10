// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { ScimSyncActivityEntry } from "@langwatch/enterprise-scim-contract";

import { ScimSyncActivityRepository } from "../scim-sync-activity.repository.ts";

interface HeldActivity {
  organizationId: string;
  connectionId: string;
  entry: ScimSyncActivityEntry;
}

/** A connection's directory activity over the facts a test hands it; a fresh one holds none. */
export class MemoryScimSyncActivityRepository extends ScimSyncActivityRepository {
  static create(): MemoryScimSyncActivityRepository {
    return new MemoryScimSyncActivityRepository();
  }

  readonly #held: HeldActivity[] = [];

  private constructor() {
    super();
  }

  add(activity: HeldActivity): void {
    this.#held.push(activity);
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
    return this.#held
      .filter(
        (held) => held.organizationId === organizationId && held.connectionId === connectionId,
      )
      .map((held) => held.entry)
      .toSorted((a, b) => b.occurredAtMs - a.occurredAtMs || b.eventId.localeCompare(a.eventId))
      .slice(0, limit);
  }
}
