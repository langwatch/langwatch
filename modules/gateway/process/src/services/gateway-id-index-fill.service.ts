import type { FillIdIndexesOptions, IdIndexFillReport } from "@langwatch/clickhouse-client";

import type { GatewayIdIndexFillRepository } from "../repositories/gateway-id-index-fill.repository.ts";

/** What the step hands the fill: where it resumes, whether to write, when to stop. */
type FillRun = Pick<FillIdIndexesOptions, "checkpoint" | "dryRun" | "signal">;

/**
 * Fills the gateway ledger's id indexes from rows older than their views, then writes each
 * target's marker rows. The ledger has no TTL, so no index copies a retention to raise.
 */
export class GatewayIdIndexFillService {
  static create(dependencies: { fills: GatewayIdIndexFillRepository }): GatewayIdIndexFillService {
    return new GatewayIdIndexFillService(dependencies);
  }

  private constructor(private readonly dependencies: { fills: GatewayIdIndexFillRepository }) {}

  fillIdIndexes(run: FillRun): Promise<IdIndexFillReport> {
    return this.dependencies.fills.fill({ ...run, raiseRetention: () => Promise.resolve() });
  }
}
