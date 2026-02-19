import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { Command, CommandHandler } from "../../../";
import {
	createTenantId,
	defineCommandSchema,
	EventUtils,
} from "../../../";
import { createLogger } from "../../../../../utils/logger/server";
import type { AssignTopicCommandData } from "../schemas/commands";
import { assignTopicCommandDataSchema } from "../schemas/commands";
import {
	ASSIGN_TOPIC_COMMAND_TYPE,
	TOPIC_ASSIGNED_EVENT_TYPE,
	TOPIC_ASSIGNED_EVENT_VERSION_LATEST,
} from "../schemas/constants";
import type { TopicAssignedEvent } from "../schemas/events";

/**
 * Command handler for assigning topics to traces in the trace processing pipeline.
 */
export class AssignTopicCommand implements CommandHandler<
  Command<AssignTopicCommandData>,
  TopicAssignedEvent
> {
  static readonly schema = defineCommandSchema(
    ASSIGN_TOPIC_COMMAND_TYPE,
    assignTopicCommandDataSchema,
    "Command to assign a topic to a trace in the trace processing pipeline",
  );

  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.assign-topic",
  );
  private readonly logger = createLogger(
    "langwatch:trace-processing:assign-topic",
  );

  async handle(
    command: Command<AssignTopicCommandData>,
  ): Promise<TopicAssignedEvent[]> {
    return await this.tracer.withActiveSpan(
      "AssignTopicCommand.handle",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "command.type": command.type,
          "command.aggregate_id": command.aggregateId,
          "tenant.id": command.tenantId,
        },
      },
      async () => {
        const { tenantId: tenantIdStr, data: commandData } = command;
        const tenantId = createTenantId(tenantIdStr);

        this.logger.debug(
          {
            tenantId,
            traceId: commandData.traceId,
            topicId: commandData.topicId,
            subtopicId: commandData.subtopicId,
          },
          "Handling assign topic command",
        );

        const topicAssignedEvent = EventUtils.createEvent<TopicAssignedEvent>({
          aggregateType: "trace",
          aggregateId: commandData.traceId,
          tenantId,
          type: TOPIC_ASSIGNED_EVENT_TYPE,
          version: TOPIC_ASSIGNED_EVENT_VERSION_LATEST,
          data: {
            topicId: commandData.topicId,
            topicName: commandData.topicName,
            subtopicId: commandData.subtopicId,
            subtopicName: commandData.subtopicName,
            isIncremental: commandData.isIncremental,
          },
        });

        this.logger.debug(
          {
            tenantId,
            traceId: commandData.traceId,
            eventId: topicAssignedEvent.id,
          },
          "Emitting TopicAssignedEvent",
        );

        return [topicAssignedEvent];
      },
    );
  }

  static getAggregateId(payload: AssignTopicCommandData): string {
    return payload.traceId;
  }

  static getSpanAttributes(
    payload: AssignTopicCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.trace.id": payload.traceId,
      "payload.topic.id": payload.topicId ?? "",
      "payload.subtopic.id": payload.subtopicId ?? "",
    };
  }

  static makeJobId(payload: AssignTopicCommandData): string {
    return `${payload.tenantId}:${payload.traceId}:topic`;
  }
}
