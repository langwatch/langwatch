import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { Command, CommandHandler } from "../../../";
import {
  createTenantId,
  defineCommandSchema,
  EventUtils,
} from "../../../";
import { createLogger } from "../../../../../utils/logger/server";
import type { AssignSatisfactionScoreCommandData } from "../schemas/commands";
import { assignSatisfactionScoreCommandDataSchema } from "../schemas/commands";
import {
  ASSIGN_SATISFACTION_SCORE_COMMAND_TYPE,
  SATISFACTION_SCORE_ASSIGNED_EVENT_TYPE,
  SATISFACTION_SCORE_ASSIGNED_EVENT_VERSION_LATEST,
} from "../schemas/constants";
import type { SatisfactionScoreAssignedEvent } from "../schemas/events";

export class AssignSatisfactionScoreCommand
  implements
    CommandHandler<
      Command<AssignSatisfactionScoreCommandData>,
      SatisfactionScoreAssignedEvent
    >
{
  static readonly schema = defineCommandSchema(
    ASSIGN_SATISFACTION_SCORE_COMMAND_TYPE,
    assignSatisfactionScoreCommandDataSchema,
    "Command to assign a satisfaction score to a trace",
  );

  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.assign-satisfaction-score",
  );
  private readonly logger = createLogger(
    "langwatch:trace-processing:assign-satisfaction-score",
  );

  async handle(
    command: Command<AssignSatisfactionScoreCommandData>,
  ): Promise<SatisfactionScoreAssignedEvent[]> {
    return await this.tracer.withActiveSpan(
      "AssignSatisfactionScoreCommand.handle",
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
            satisfactionScore: commandData.satisfactionScore,
          },
          "Handling assign satisfaction score command",
        );

        const event =
          EventUtils.createEvent<SatisfactionScoreAssignedEvent>({
            aggregateType: "trace",
            aggregateId: commandData.traceId,
            tenantId,
            type: SATISFACTION_SCORE_ASSIGNED_EVENT_TYPE,
            version: SATISFACTION_SCORE_ASSIGNED_EVENT_VERSION_LATEST,
            data: {
              satisfactionScore: commandData.satisfactionScore,
            },
          });

        return [event];
      },
    );
  }

  static getAggregateId(
    payload: AssignSatisfactionScoreCommandData,
  ): string {
    return payload.traceId;
  }

  static getSpanAttributes(
    payload: AssignSatisfactionScoreCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.trace.id": payload.traceId,
      "payload.satisfaction_score": payload.satisfactionScore,
    };
  }

  static makeJobId(payload: AssignSatisfactionScoreCommandData): string {
    return `${payload.tenantId}:${payload.traceId}:satisfaction`;
  }
}
