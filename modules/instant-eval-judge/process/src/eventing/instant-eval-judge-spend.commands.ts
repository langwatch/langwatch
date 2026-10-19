import {
  type Command,
  type CommandHandler,
  createTenantId,
  defineCommandSchema,
  EventSchema,
  EventUtils,
} from "@langwatch/eventing";
import {
  INSTANT_EVAL_JUDGE_SPEND_AGGREGATE_TYPE,
  INSTANT_EVAL_JUDGE_SPEND_EVENT_VERSION,
  INSTANT_EVAL_JUDGE_SPEND_PRICED_EVENT_TYPE,
  instantEvalJudgeSpendPricedEventDataSchema,
  type InstantEvalJudgeSpendPricedEventData,
} from "@langwatch/instant-eval-judge-contract";
import { z } from "zod";

const RECORD_INSTANT_EVAL_JUDGE_SPEND_PRICED_COMMAND_TYPE =
  "lw.instant_eval_judge.record_spend_priced" as const;

export const instantEvalJudgeSpendPricedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(INSTANT_EVAL_JUDGE_SPEND_PRICED_EVENT_TYPE),
  version: z.literal(INSTANT_EVAL_JUDGE_SPEND_EVENT_VERSION),
  data: instantEvalJudgeSpendPricedEventDataSchema,
});
export type InstantEvalJudgeSpendPricedEvent = z.infer<
  typeof instantEvalJudgeSpendPricedEventSchema
>;

/** Records one priced judge call on the organization's aggregate, keyed by its request. */
export class RecordInstantEvalJudgeSpendPricedCommand implements CommandHandler<
  Command<InstantEvalJudgeSpendPricedEventData>,
  InstantEvalJudgeSpendPricedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_INSTANT_EVAL_JUDGE_SPEND_PRICED_COMMAND_TYPE,
    instantEvalJudgeSpendPricedEventDataSchema,
    "Record that an Instant Evals judge call was priced",
  );

  handle(
    command: Command<InstantEvalJudgeSpendPricedEventData>,
  ): InstantEvalJudgeSpendPricedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<InstantEvalJudgeSpendPricedEvent>({
        aggregateType: INSTANT_EVAL_JUDGE_SPEND_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: INSTANT_EVAL_JUDGE_SPEND_PRICED_EVENT_TYPE,
        version: INSTANT_EVAL_JUDGE_SPEND_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:spend-priced:${data.requestId}`,
      }),
    ];
  }

  static getAggregateId(payload: InstantEvalJudgeSpendPricedEventData): string {
    return payload.organizationId;
  }
}
