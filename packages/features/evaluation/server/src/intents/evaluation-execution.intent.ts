import type { Command, CommandHandler } from "@langwatch/eventing";
import { defineCommandSchema } from "@langwatch/eventing";
import {
  type EvaluationProcessingEvent,
  EXECUTE_EVALUATION_COMMAND_TYPE,
  executeEvaluationCommandDataSchema,
  type ExecuteEvaluationCommandData,
} from "@langwatch/evaluation-contract";
import { EvaluationExecutionIntentPort } from "../ports/evaluation.port";

const schema = defineCommandSchema(
  EXECUTE_EVALUATION_COMMAND_TYPE,
  executeEvaluationCommandDataSchema,
  "Command to execute a single evaluation",
);

/** Retry-safe command boundary for Evaluation execution effects. */
export class ExecuteEvaluationCommand implements CommandHandler<
  Command<ExecuteEvaluationCommandData>,
  EvaluationProcessingEvent
> {
  static readonly schema = schema;

  static create(intent: EvaluationExecutionIntentPort): ExecuteEvaluationCommand {
    return new ExecuteEvaluationCommand(intent);
  }

  private constructor(private readonly intent: EvaluationExecutionIntentPort) {}

  static getAggregateId(payload: ExecuteEvaluationCommandData): string {
    return payload.evaluationId;
  }

  static getSpanAttributes(
    payload: ExecuteEvaluationCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.evaluation.id": payload.evaluationId,
      "payload.evaluator.id": payload.evaluatorId,
      "payload.evaluator.type": payload.evaluatorType,
      "payload.trace.id": payload.traceId,
    };
  }

  static makeJobId(payload: ExecuteEvaluationCommandData): string {
    if (payload.threadIdleTimeout && payload.threadIdleTimeout > 0 && payload.threadId) {
      return `exec:${payload.tenantId}:thread:${payload.threadId}:${payload.evaluatorId}`;
    }
    return `exec:${payload.tenantId}:${payload.traceId}:${payload.evaluatorId}`;
  }

  handle(command: Command<ExecuteEvaluationCommandData>): Promise<EvaluationProcessingEvent[]> {
    return this.intent.execute(command.data);
  }
}
