import { EVALUATION_EVENT_TYPES } from "@langwatch/evaluation-contract";
import type { AppendStore, Event, MapProjectionDefinition } from "@langwatch/eventing";
import { SIMULATION_RUN_EVENT_TYPES } from "@langwatch/scenario-contract";
import { SPAN_RECEIVED_EVENT_TYPE } from "@langwatch/trace-contract";

import type { BillableEventRecord } from "../repositories/billable-events-meter.repository.ts";

/**
 * Experiment-run event types as literals: their constant lives in experiment's process
 * half, which a module may not import. Wire values, so they never change without a migration.
 */
const EXPERIMENT_RUN_STARTED_EVENT_TYPE = "lw.experiment_run.started";
const EXPERIMENT_RUN_EVALUATOR_RESULT_EVENT_TYPE = "lw.experiment_run.evaluator_result";
const EXPERIMENT_RUN_TARGET_RESULT_EVENT_TYPE = "lw.experiment_run.target_result";

/**
 * Frozen: the name is half of the routing key `global:handler:orgBillableEventsMeter`, so
 * a rename leaves queued jobs unroutable and stalls every billable event unnoticed.
 */
export const BILLABLE_EVENTS_METER_PROJECTION_NAME = "orgBillableEventsMeter";

/**
 * One billable row per billable event, across every pipeline, so the month reads one table.
 * The store resolves the organization and writes through its organization-keyed ClickHouse
 * client, so a private-instance customer's rows stay on their own cluster.
 */
export class BillableEventsMeterProjection {
  static create(store: AppendStore<BillableEventRecord>): BillableEventsMeterProjection {
    return new BillableEventsMeterProjection(store);
  }

  private constructor(private readonly store: AppendStore<BillableEventRecord>) {}

  /** One lane per event, because two rows for one event deduplicate on read. */
  static groupKey(event: Event): string {
    return `billing:${event.id}`;
  }

  /**
   * The producer's `idempotencyKey` where set (an evaluation's is
   * `${tenantId}:${evaluationId}:reported`, billed once however often reported), else `event.id`.
   */
  static deduplicationKey(event: Event): string {
    return event.idempotencyKey ?? event.id;
  }

  build(): MapProjectionDefinition<BillableEventRecord, Event> {
    return {
      name: BILLABLE_EVENTS_METER_PROJECTION_NAME,
      eventTypes: [
        SPAN_RECEIVED_EVENT_TYPE,

        // `reported` is the only evaluation event production emits; `scheduled` and
        // `started` occur only in test presets (issue #5124) and are not subscribed.
        EVALUATION_EVENT_TYPES.REPORTED,

        EXPERIMENT_RUN_STARTED_EVENT_TYPE,
        EXPERIMENT_RUN_EVALUATOR_RESULT_EVENT_TYPE,
        EXPERIMENT_RUN_TARGET_RESULT_EVENT_TYPE,

        SIMULATION_RUN_EVENT_TYPES.STARTED,
        SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT,
      ],

      options: {
        // Wrapped rather than passed bare: a bare static-method reference
        // trips `typescript/unbound-method` even though `groupKey` never
        // reads `this`.
        groupKeyFn: (event: Event) => BillableEventsMeterProjection.groupKey(event),
      },

      map: (event: Event): BillableEventRecord => ({
        organizationId: "", // resolved by the store
        tenantId: String(event.tenantId),
        eventId: event.id,
        eventType: event.type,
        deduplicationKey: BillableEventsMeterProjection.deduplicationKey(event),
        eventTimestamp: event.createdAt,
      }),

      store: this.store,
    };
  }
}
