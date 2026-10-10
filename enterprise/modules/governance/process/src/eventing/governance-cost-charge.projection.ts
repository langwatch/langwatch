// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** One row per pulled charge, beside the fold. @see specs/governance/cost-rollup-watch.feature */
import {
  type PulledUsageObservedEvent,
  type PulledUsageRetractedEvent,
  pulledUsageObservedEventSchema,
  pulledUsageRetractedEventSchema,
  readPulledUsageMoney,
} from "@langwatch/enterprise-governance-contract";
import { AbstractMapProjection, type MapEventHandlers } from "@langwatch/eventing";

import {
  GOVERNANCE_COST_CHARGE_TABLE,
  type GovernanceCostChargeRepository,
  type GovernanceCostChargeRow,
} from "../repositories/governance-cost-charge.repository.ts";
import type { GovernanceCostRollupFoldProjection } from "./governance-cost-rollup.projection.ts";

const events = [pulledUsageObservedEventSchema, pulledUsageRetractedEventSchema] as const;

export const GOVERNANCE_COST_CHARGE_PROJECTION_NAME = "governanceCostCharges";

/** The cell comes from the fold's own `cellOf`, so both records file a charge under one key. */
export class GovernanceCostChargeMapProjection
  extends AbstractMapProjection<GovernanceCostChargeRow, typeof events>
  implements MapEventHandlers<typeof events, GovernanceCostChargeRow>
{
  readonly name = GOVERNANCE_COST_CHARGE_PROJECTION_NAME;
  readonly targetTable = GOVERNANCE_COST_CHARGE_TABLE;
  protected readonly events = events;

  private constructor(
    readonly store: GovernanceCostChargeRepository,
    private readonly cells: Pick<GovernanceCostRollupFoldProjection, "cellOf">,
  ) {
    super();
  }

  static create({
    store,
    cells,
  }: {
    store: GovernanceCostChargeRepository;
    cells: Pick<GovernanceCostRollupFoldProjection, "cellOf">;
  }): GovernanceCostChargeMapProjection {
    return new GovernanceCostChargeMapProjection(store, cells);
  }

  mapPulledUsageObserved(event: PulledUsageObservedEvent): GovernanceCostChargeRow {
    return this.rowOf({
      event,
      isRetraction: false,
      amountNanoMinor: readPulledUsageMoney(event.data).costNanoMinor,
    });
  }

  mapPulledUsageRetracted(event: PulledUsageRetractedEvent): GovernanceCostChargeRow {
    return this.rowOf({ event, isRetraction: true, amountNanoMinor: 0 });
  }

  private rowOf({
    event,
    isRetraction,
    amountNanoMinor,
  }: {
    event: PulledUsageObservedEvent | PulledUsageRetractedEvent;
    isRetraction: boolean;
    amountNanoMinor: number;
  }): GovernanceCostChargeRow {
    const cell = this.cells.cellOf(event);
    return {
      TenantId: cell.tenantId,
      Day: cell.day,
      CostSource: cell.costSource,
      IngestionSourceId: cell.ingestionSourceId,
      Provider: cell.provider,
      Model: cell.model,
      AgentId: cell.agentId,
      CurrencyCode: cell.currencyCode,
      RawActorId: cell.rawActorId,
      EventId: event.id,
      RestatementKey: event.data.restatementKey,
      IsRetraction: isRetraction,
      ObservedAtMs: event.data.observedAtMs,
      AmountNanoMinor: amountNanoMinor,
      EventOccurredAt: event.occurredAt,
    };
  }
}
