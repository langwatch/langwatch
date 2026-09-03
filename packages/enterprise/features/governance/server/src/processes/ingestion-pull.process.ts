import {
  INGESTION_PULL_EVENT_TYPES,
  isValidPullSchedule,
  type IngestionPullProcessingEvent,
} from "@langwatch/enterprise-governance-contract";
import type {
  Event,
  ProcessHandlerContext,
  ProcessIntent,
  ProcessManagerApplier,
} from "@langwatch/eventing";
import type { IntentSpec } from "@langwatch/eventing";
import {
  IngestionPullIntent,
  ingestionPullRunIntentSchema,
} from "../intents/ingestion-pull.intent";
import type { IngestionPullSchedulePort } from "../ports/ingestion-pull.port";
import {
  INGESTION_PULL_CONCURRENCY,
  INGESTION_PULL_LEASE_DURATION_MS,
  INGESTION_PULL_MAX_ATTEMPTS,
  IngestionPullService,
} from "../services/ingestion-pull.service";

export const INGESTION_PULL_PROCESS_NAME = "ingestionPull" as const;
export const INGESTION_PULL_STALE_RUN_MS = 30 * 60 * 1_000;

type IngestionPullEvent = IngestionPullProcessingEvent & Event;
type IngestionPullIntents = {
  run: IntentSpec<typeof ingestionPullRunIntentSchema>;
};

export type IngestionPullProcessState = {
  sourceId: string;
  enabled: boolean;
  cron: string | null;
  cursor: string | null;
  currentRun: {
    runId: string;
    scheduledFor: number;
    startedAt: number;
  } | null;
};

const INITIAL_STATE: IngestionPullProcessState = {
  sourceId: "",
  enabled: false,
  cron: null,
  cursor: null,
  currentRun: null,
};

type ProcessContext = ProcessHandlerContext<IngestionPullIntents>;

export class IngestionPullProcess {
  private constructor(
    private readonly schedule: IngestionPullSchedulePort,
    private readonly intent: IngestionPullIntent,
  ) {}

  static create(options: {
    schedule: IngestionPullSchedulePort;
    execution: IngestionPullService;
  }): IngestionPullProcess {
    return new IngestionPullProcess(
      options.schedule,
      IngestionPullIntent.create(options.execution),
    );
  }

  processManager(): ProcessManagerApplier<IngestionPullEvent> {
    return (process) =>
      process
        .state(INITIAL_STATE)
        .intent("run", ingestionPullRunIntentSchema, (payload, context) =>
          this.intent.execute(payload, context),
        )
        .on(INGESTION_PULL_EVENT_TYPES.CONFIGURED, (state, data, context) => {
          if (!isValidPullSchedule(data.cron)) {
            return { state, nextWakeAt: null, intents: [] };
          }
          return this.settle({
            state: {
              ...state,
              sourceId: data.sourceId,
              enabled: true,
              cron: data.cron,
              cursor: state.sourceId ? state.cursor : data.cursor,
            },
            after: this.schedulingReference(context),
          });
        })
        .on(INGESTION_PULL_EVENT_TYPES.DISABLED, (state, data) => ({
          state: {
            ...state,
            sourceId: data.sourceId,
            enabled: false,
            cron: null,
            currentRun: null,
          },
          nextWakeAt: null,
          intents: [],
        }))
        .on(INGESTION_PULL_EVENT_TYPES.RUN_COMPLETED, (state, data, context) => {
          const current = state.currentRun?.runId === data.runId;
          return this.settle({
            state: {
              ...state,
              cursor: current ? data.nextCursor : state.cursor,
              currentRun: current ? null : state.currentRun,
            },
            after: this.schedulingReference(context),
          });
        })
        .on(INGESTION_PULL_EVENT_TYPES.RUN_FAILED, (state, data, context) =>
          this.settle({
            state: {
              ...state,
              currentRun: state.currentRun?.runId === data.runId ? null : state.currentRun,
            },
            after: this.schedulingReference(context),
          }),
        )
        .onWake((state, context) => this.wake(state, context))
        .outbox({
          maxAttempts: INGESTION_PULL_MAX_ATTEMPTS,
          leaseDurationMs: INGESTION_PULL_LEASE_DURATION_MS,
          concurrency: INGESTION_PULL_CONCURRENCY,
          batchSize: INGESTION_PULL_CONCURRENCY,
        });
  }

  private schedulingReference(context: ProcessContext): number {
    return Math.max(context.at, context.now);
  }

  private settle(input: {
    state: IngestionPullProcessState;
    after: number;
    intents?: ProcessIntent[];
  }) {
    return {
      state: input.state,
      nextWakeAt:
        input.state.enabled && input.state.cron
          ? this.schedule.nextRunAt({
              cron: input.state.cron,
              after: input.after,
            })
          : null,
      intents: input.intents ?? [],
    };
  }

  private wake(state: IngestionPullProcessState, context: ProcessContext) {
    if (!state.enabled || !state.cron) {
      return { state, nextWakeAt: null, intents: [] };
    }
    const active =
      state.currentRun !== null &&
      context.now - state.currentRun.startedAt < INGESTION_PULL_STALE_RUN_MS;
    if (active) return this.settle({ state, after: context.now });

    const runId = String(context.at);
    return this.settle({
      state: {
        ...state,
        currentRun: {
          runId,
          scheduledFor: context.at,
          startedAt: context.now,
        },
      },
      after: context.now,
      intents: [
        context.intents.run(`pull:${runId}`, {
          sourceId: state.sourceId,
          runId,
          scheduledFor: context.at,
          cursor: state.cursor,
        }),
      ],
    });
  }
}
