// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Port of main's `governanceCostRollup.foldProjection.ts` (ADR-128 wave 1). @see specs/governance/governance-cost-restatement-markers.feature */
import {
  PULLED_USAGE_EVENT_TYPES,
  type PulledUsageObservedEvent,
  type PulledUsageRetractedEvent,
  pulledUsageObservedEventSchema,
  pulledUsageRetractedEventSchema,
  readPulledUsageMoney,
} from "@langwatch/enterprise-governance-contract";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
  type FoldProjectionStore,
} from "@langwatch/eventing";

import {
  GOVERNANCE_COST_CURRENCY_USD,
  GOVERNANCE_COST_ROLLUP_PROJECTION_NAME,
  GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
  GOVERNANCE_COST_SOURCE,
} from "../repositories/governance-cost-rollup.repository.ts";
import {
  encodeGovernanceCostRollupKey,
  type GovernanceCostRollupCell,
  type GovernanceCostRollupState,
  type PulledContribution,
  revisionMarkersAfterPull,
  utcDayOf,
  withDerivedRevisionMarkers,
} from "../rules/governance-cost-rollup-cell.rules.ts";

/** The pulled lane only: the metered lane is read straight off gateway's own ledger. */
const governanceCostRollupEvents = [
  pulledUsageObservedEventSchema,
  pulledUsageRetractedEventSchema,
] as const;

type GovernanceCostRollupEvent = PulledUsageObservedEvent | PulledUsageRetractedEvent;

/** Erasure's pseudonym substitution, applied at the key so a replay cannot write the original back. */
export interface GovernanceCostRollupActorIds {
  actorIdForRollupWrite: (input: { tenantId: string; rawActorId: string }) => string;
}

/** Sound once parsed: the pipeline parses each event with its declared schema at dispatch. */
function isGovernanceCostRollupEvent(event: { type: string }): event is GovernanceCostRollupEvent {
  return (
    event.type === PULLED_USAGE_EVENT_TYPES.OBSERVED ||
    event.type === PULLED_USAGE_EVENT_TYPES.RETRACTED
  );
}

export class GovernanceCostRollupFoldProjection
  extends AbstractFoldProjection<
    GovernanceCostRollupState,
    typeof governanceCostRollupEvents,
    "createdAt",
    "updatedAt",
    "LastEventOccurredAt"
  >
  implements FoldEventHandlers<typeof governanceCostRollupEvents, GovernanceCostRollupState>
{
  readonly name = GOVERNANCE_COST_ROLLUP_PROJECTION_NAME;
  readonly version = GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST;
  readonly store: FoldProjectionStore<GovernanceCostRollupState>;
  protected readonly events = governanceCostRollupEvents;

  /** A re-fold loads one pulled item's history, never the day-wide cell; the fold commutes instead. */
  readonly options = { refoldOnOutOfOrder: false } as const;

  /** The day x dimension cell, not the event's own aggregate; loud for an undeclared type. */
  readonly key = (event: { type: string }): string => {
    if (!isGovernanceCostRollupEvent(event)) {
      throw new Error(`governance cost rollup cannot address a cell for a ${event.type} event`);
    }
    return encodeGovernanceCostRollupKey(this.cellOf(event));
  };

  private constructor(
    store: FoldProjectionStore<GovernanceCostRollupState>,
    private readonly actorIds: GovernanceCostRollupActorIds,
  ) {
    super({
      createdAtKey: "createdAt",
      updatedAtKey: "updatedAt",
      LastEventOccurredAtKey: "LastEventOccurredAt",
    });
    this.store = store;
  }

  static create({
    store,
    actorIds,
  }: {
    store: FoldProjectionStore<GovernanceCostRollupState>;
    actorIds: GovernanceCostRollupActorIds;
  }): GovernanceCostRollupFoldProjection {
    return new GovernanceCostRollupFoldProjection(store, actorIds);
  }

  /** Both events name the whole cell, the spender and the agent included (ADR-129, #7881). */
  cellOf(event: GovernanceCostRollupEvent): GovernanceCostRollupCell {
    const tenantId = String(event.tenantId);
    return {
      tenantId,
      day: utcDayOf(event.data.occurredAtMs),
      costSource: GOVERNANCE_COST_SOURCE.PULLED,
      ingestionSourceId: event.data.ingestionSourceId,
      provider: event.data.source,
      model: event.data.model,
      agentId: event.data.agentId,
      currencyCode: readPulledUsageMoney(event.data).currencyCode,
      rawActorId: this.actorIds.actorIdForRollupWrite({
        tenantId,
        rawActorId: event.data.rawActorId,
      }),
    };
  }

  protected initState(): Omit<
    GovernanceCostRollupState,
    "createdAt" | "updatedAt" | "LastEventOccurredAt"
  > {
    return {
      day: "",
      costSource: "",
      ingestionSourceId: "",
      provider: "",
      model: "",
      agentId: "",
      currencyCode: GOVERNANCE_COST_CURRENCY_USD,
      rawActorId: "",
      organizationId: "",
      exactOrEstimate: "",
      pulledItems: {},
      revisionCount: 0,
      previousAmountNanoUsd: null,
      revisedAt: null,
      lastObservedAt: 0,
    };
  }

  handlePulledUsageObserved(
    event: PulledUsageObservedEvent,
    state: GovernanceCostRollupState,
  ): GovernanceCostRollupState {
    const d = event.data;
    const previous = state.pulledItems[d.restatementKey];
    const money = readPulledUsageMoney(d);
    if (previous && previous.observedAtMs >= d.observedAtMs) {
      return this.foldStaleObservation({ state, previous, event });
    }
    const movedTheFigure =
      previous !== undefined && previous.amountNanoMinor !== money.costNanoMinor;
    return withDerivedRevisionMarkers({
      ...state,
      ...this.dimensionsOf(event),
      organizationId: d.organizationId,
      exactOrEstimate: d.costStatus,
      pulledItems: {
        ...state.pulledItems,
        [d.restatementKey]: {
          amountNanoMinor: money.costNanoMinor,
          amountNanoUsd: money.costNanoUsd,
          observedAtMs: d.observedAtMs,
          ...revisionMarkersAfterPull({ previous, movedTheFigure, observedAtMs: d.observedAtMs }),
          tokensInput: d.tokensInput,
          tokensOutput: d.tokensOutput,
          tokensCacheRead: d.tokensCacheRead,
          tokensCacheWrite: d.tokensCacheWrite,
          exactOrEstimate: d.costStatus,
        },
      },
      lastObservedAt: Math.max(state.lastObservedAt, d.observedAtMs),
      revisionCount: movedTheFigure ? state.revisionCount + 1 : state.revisionCount,
    });
  }

  /** Zero rather than removed: a retraction is knowledge that the item holds nothing, and it is a revision. */
  handlePulledUsageRetracted(
    event: PulledUsageRetractedEvent,
    state: GovernanceCostRollupState,
  ): GovernanceCostRollupState {
    const d = event.data;
    const previous = state.pulledItems[d.restatementKey];
    if (previous !== undefined && previous.observedAtMs > d.observedAtMs) return state;
    const movedTheFigure = (previous?.amountNanoMinor ?? 0) !== 0;
    return withDerivedRevisionMarkers({
      ...state,
      ...this.dimensionsOf(event),
      pulledItems: {
        ...state.pulledItems,
        [d.restatementKey]: {
          ...previous,
          exactOrEstimate: previous?.exactOrEstimate ?? "exact",
          amountNanoMinor: 0,
          amountNanoUsd: 0,
          tokensInput: 0,
          tokensOutput: 0,
          tokensCacheRead: 0,
          tokensCacheWrite: 0,
          observedAtMs: d.observedAtMs,
          ...revisionMarkersAfterPull({ previous, movedTheFigure, observedAtMs: d.observedAtMs }),
        },
      },
      organizationId: d.organizationId || state.organizationId,
      lastObservedAt: Math.max(state.lastObservedAt, d.observedAtMs),
      revisionCount: movedTheFigure ? state.revisionCount + 1 : state.revisionCount,
    });
  }

  /** An older look that differs from the item now is evidence of what it held before the change. */
  private foldStaleObservation({
    state,
    previous,
    event,
  }: {
    state: GovernanceCostRollupState;
    previous: PulledContribution;
    event: PulledUsageObservedEvent;
  }): GovernanceCostRollupState {
    const d = event.data;
    const money = readPulledUsageMoney(d);
    const revealsChange = money.costNanoMinor !== previous.amountNanoMinor;
    const isCloserLook =
      d.observedAtMs < previous.observedAtMs &&
      (previous.priorObservedAtMs === undefined || d.observedAtMs > previous.priorObservedAtMs);
    if (!revealsChange || !isCloserLook) return state;
    return withDerivedRevisionMarkers({
      ...state,
      pulledItems: {
        ...state.pulledItems,
        [d.restatementKey]: {
          ...previous,
          priorAmountNanoMinor: money.costNanoMinor,
          priorAmountNanoUsd: money.costNanoUsd,
          priorObservedAtMs: d.observedAtMs,
          revisedAtMs: previous.observedAtMs,
        },
      },
    });
  }

  private dimensionsOf(
    event: GovernanceCostRollupEvent,
  ): Omit<GovernanceCostRollupCell, "tenantId"> {
    const { tenantId: _tenantId, ...dimensions } = this.cellOf(event);
    return dimensions;
  }
}
