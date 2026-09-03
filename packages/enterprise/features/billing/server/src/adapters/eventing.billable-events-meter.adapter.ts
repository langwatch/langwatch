// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  AppendStore,
  Event,
  MapProjectionDefinition,
  ProjectionStoreContext,
} from "@langwatch/eventing";
import { EVALUATION_EVENT_TYPES } from "@langwatch/evaluation-contract";
import { SIMULATION_RUN_EVENT_TYPES } from "@langwatch/scenario-contract";
import { SPAN_RECEIVED_EVENT_TYPE } from "@langwatch/trace-contract";
import type {
  BillableEventsMeterPort,
  BillableEventRecord,
} from "../ports/billable-events-meter.port";
import type { BillingTenantOrganizationService } from "../services/tenant-organization.service";

/**
 * The experiment-run event types this meter counts, as literals.
 *
 * `EXPERIMENT_RUN_EVENT_TYPES` lives in `@langwatch/experiment-server`, and a
 * feature package may not import another feature's server — so the three
 * strings are stated here and pinned by this package's own test against the
 * shape the App's twin subscribes to. They are wire values on events already
 * in the store, so they cannot change without a migration either way.
 */
const EXPERIMENT_RUN_STARTED_EVENT_TYPE = "lw.experiment_run.started";
const EXPERIMENT_RUN_EVALUATOR_RESULT_EVENT_TYPE = "lw.experiment_run.evaluator_result";
const EXPERIMENT_RUN_TARGET_RESULT_EVENT_TYPE = "lw.experiment_run.target_result";

/**
 * The projection's name, and the lane its work is grouped into.
 *
 * Frozen twin: `orgBillableEventsMeter.mapProjection.ts` in the App declares
 * the identical pair, and both graphs register into one `event-sourcing/jobs`
 * queue. The name is half of the routing key `global:handler:
 * orgBillableEventsMeter`, so a rename on one side leaves the other's jobs
 * unroutable — rejected for redelivery rather than dropped, which stalls every
 * billable event forever while the fleet looks healthy.
 */
export const BILLABLE_EVENTS_METER_PROJECTION_NAME = "orgBillableEventsMeter";

/**
 * The cross-pipeline meter that records one billable row per billable event.
 *
 * It is a map projection rather than a pipeline because it spans every
 * pipeline: a span, an evaluation, an experiment result and a simulation
 * message are all billable units, and counting them in one place is what lets
 * the monthly roll-up read a single table. The App configures the identical
 * pair on its own runtime, gated on the one deployment fact both graphs read.
 *
 * The store resolves the organization the row is billed to and writes through
 * an organization-keyed ClickHouse client: billing routes private-instance
 * customers to their own cluster, so a row written to the shared instance for
 * such a customer is both a mis-bill and data in a place they did not agree to.
 */
export class EventingBillableEventsMeterAdapter {
  static create(options: {
    meter: BillableEventsMeterPort;
    organizations: BillingTenantOrganizationService;
  }): EventingBillableEventsMeterAdapter {
    return new EventingBillableEventsMeterAdapter(options.meter, options.organizations);
  }

  private constructor(
    private readonly meter: BillableEventsMeterPort,
    private readonly organizations: BillingTenantOrganizationService,
  ) {}

  /** One lane per event, because two rows for one event deduplicate on read. */
  static groupKey(event: Event): string {
    return `billing:${event.id}`;
  }

  /**
   * The event's deduplication key.
   *
   * `idempotencyKey` where the producer set one, because that is the business
   * identity a retry and a replay collapse onto — an evaluation's is
   * `${tenantId}:${evaluationId}:reported`, so a customer is billed once for
   * one evaluation however many times it is reported. `event.id` otherwise,
   * which is unique per event and therefore counts each one exactly once.
   */
  static deduplicationKey(event: Event): string {
    return event.idempotencyKey ?? event.id;
  }

  build(): MapProjectionDefinition<BillableEventRecord, Event> {
    return {
      name: BILLABLE_EVENTS_METER_PROJECTION_NAME,
      eventTypes: [
        SPAN_RECEIVED_EVENT_TYPE,

        // `reported` is the only evaluation event production ever emits (via
        // reportEvaluation / ReportEvaluationCommand / ExecuteEvaluationCommand).
        // Its idempotencyKey is `${tenantId}:${evaluationId}:reported`, so retries
        // and replays collapse to exactly one billable unit per evaluation. The
        // previously listed `scheduled`/`started` types are never produced outside
        // test presets (see issue #5124) and are intentionally not subscribed.
        EVALUATION_EVENT_TYPES.REPORTED,

        EXPERIMENT_RUN_STARTED_EVENT_TYPE,
        EXPERIMENT_RUN_EVALUATOR_RESULT_EVENT_TYPE,
        EXPERIMENT_RUN_TARGET_RESULT_EVENT_TYPE,

        SIMULATION_RUN_EVENT_TYPES.STARTED,
        SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT,
      ],

      options: {
        groupKeyFn: EventingBillableEventsMeterAdapter.groupKey,
      },

      map: (event: Event): BillableEventRecord => ({
        organizationId: "", // resolved by the store
        tenantId: String(event.tenantId),
        eventId: event.id,
        eventType: event.type,
        deduplicationKey: EventingBillableEventsMeterAdapter.deduplicationKey(event),
        eventTimestamp: event.createdAt,
      }),

      store: this.store(),
    };
  }

  /**
   * The append side, as a value rather than a class: `AppendStore` is one
   * method the projection calls, and the collaborators it closes over are this
   * adapter's own.
   *
   * A failed insert throws so the queue redelivers it. That is the correct
   * trade for a meter: a redelivered row carries the same deduplication key
   * and collapses on read, while a swallowed one is revenue that was never
   * counted and leaves no trace to reconcile from.
   */
  private store(): AppendStore<BillableEventRecord> {
    return {
      append: async (
        record: BillableEventRecord,
        _context: ProjectionStoreContext,
      ): Promise<void> => {
        const organizationId = await this.organizations.tryResolveOrganizationId(record.tenantId);
        if (!organizationId) return;

        await this.meter.insert({ record, organizationId });
      },
    };
  }
}
