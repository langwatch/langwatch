import type {
  Command,
  CommandHandler,
} from "../../../";
import { createTenantId, defineCommandSchema, EventUtils } from "../../../";
import type { StartSuiteRunCommandData } from "../schemas/commands";
import { startSuiteRunCommandDataSchema } from "../schemas/commands";
import {
  SUITE_RUN_COMMAND_TYPES,
  SUITE_RUN_EVENT_VERSIONS,
  SUITE_RUN_EVENT_TYPES,
} from "../schemas/constants";
import type {
  SuiteRunProcessingEvent,
  SuiteRunStartedEvent,
} from "../schemas/events";
import { makeSuiteRunKey } from "../utils/compositeKey";
import { makeSuiteRunJobId } from "./base.command";
import { createLogger } from "../../../../../utils/logger/server";

const logger = createLogger("langwatch:suite-run-processing:start-suite-run");

const SCHEMA = defineCommandSchema(
  SUITE_RUN_COMMAND_TYPES.START,
  startSuiteRunCommandDataSchema,
  "Command to start a suite run",
);

function getAggregateId(payload: StartSuiteRunCommandData): string {
  return makeSuiteRunKey(payload.suiteId, payload.batchRunId);
}

function getSpanAttributes(
  payload: StartSuiteRunCommandData,
): Record<string, string | number | boolean> {
  return {
    "payload.suite.id": payload.suiteId,
    "payload.batchRun.id": payload.batchRunId,
    "payload.total": payload.total,
  };
}

function makeJobId(payload: StartSuiteRunCommandData): string {
  return makeSuiteRunJobId(payload, "start");
}

export interface StartSuiteRunCommandDeps {
  scheduleSuiteRunJobs: (params: {
    scenarioIds: string[];
    targets: { id: string; type: string }[];
    suiteId: string;
    projectId: string;
    setId: string;
    batchRunId: string;
    repeatCount: number;
  }) => Promise<number>;
}

/**
 * Factory that returns a CommandHandlerClass for starting a suite run.
 *
 * The returned class closes over deps so the framework can instantiate it
 * with `new ()` (zero-arg constructor) as required by `withCommand`.
 *
 * Schedules BullMQ scenario jobs, then emits SuiteRunStartedEvent.
 * Following the same pattern as createExecuteEvaluationCommandClass.
 */
export function createStartSuiteRunCommandClass(deps: StartSuiteRunCommandDeps) {
  return class StartSuiteRunCommand
    implements
      CommandHandler<
        Command<StartSuiteRunCommandData>,
        SuiteRunProcessingEvent
      >
  {
    static readonly schema = SCHEMA;
    static readonly getAggregateId = getAggregateId;
    static readonly getSpanAttributes = getSpanAttributes;
    static readonly makeJobId = makeJobId;

    async handle(
      command: Command<StartSuiteRunCommandData>,
    ): Promise<SuiteRunProcessingEvent[]> {
      const { tenantId: tenantIdStr, data } = command;
      const tenantId = createTenantId(tenantIdStr);
      const aggregateId = makeSuiteRunKey(data.suiteId, data.batchRunId);

      logger.info(
        {
          tenantId,
          suiteId: data.suiteId,
          batchRunId: data.batchRunId,
          setId: data.setId,
          total: data.total,
        },
        "Handling start suite run command",
      );

      // Schedule BullMQ scenario jobs
      await deps.scheduleSuiteRunJobs({
        scenarioIds: data.scenarioIds,
        targets: data.targets,
        suiteId: data.suiteId,
        projectId: tenantIdStr,
        setId: data.setId,
        batchRunId: data.batchRunId,
        repeatCount: data.repeatCount,
      });

      // Emit started event
      const event = EventUtils.createEvent<SuiteRunStartedEvent>({
        aggregateType: "suite_run",
        aggregateId,
        tenantId,
        type: SUITE_RUN_EVENT_TYPES.STARTED as SuiteRunStartedEvent["type"],
        version: SUITE_RUN_EVENT_VERSIONS.STARTED as SuiteRunStartedEvent["version"],
        data: {
          suiteId: data.suiteId,
          batchRunId: data.batchRunId,
          setId: data.setId,
          total: data.total,
          scenarioIds: data.scenarioIds,
          targets: data.targets,
          repeatCount: data.repeatCount,
          idempotencyKey: data.idempotencyKey,
        },
        occurredAt: data.occurredAt,
      });

      logger.debug(
        {
          tenantId,
          suiteId: data.suiteId,
          batchRunId: data.batchRunId,
          eventId: event.id,
        },
        "Emitting suite run started event",
      );

      return [event];
    }
  };
}
