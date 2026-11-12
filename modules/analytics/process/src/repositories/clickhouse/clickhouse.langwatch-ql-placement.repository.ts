import { type ClickHouseQueryClient, SHARED_CLICKHOUSE_TARGET } from "@langwatch/clickhouse-client";

import {
  type LangWatchQLPlacement,
  LangWatchQLPlacementRepository,
} from "../langwatch-ql-placement.repository.ts";

/** The routed client's own decision: what was recorded, and the server it resolves to. */
export class ClickHouseLangWatchQLPlacementRepository extends LangWatchQLPlacementRepository {
  private constructor(private readonly clickhouse: ClickHouseQueryClient) {
    super();
  }

  static create({
    clickhouse,
  }: {
    clickhouse: ClickHouseQueryClient;
  }): ClickHouseLangWatchQLPlacementRepository {
    return new ClickHouseLangWatchQLPlacementRepository(clickhouse);
  }

  async placementOf({ tenantId }: { tenantId: string }): Promise<LangWatchQLPlacement> {
    const { target, recordedPrivate, origin } = await this.clickhouse.placementOf({ tenantId });
    return { recordedPrivate, routedPrivately: target !== SHARED_CLICKHOUSE_TARGET, origin };
  }
}
