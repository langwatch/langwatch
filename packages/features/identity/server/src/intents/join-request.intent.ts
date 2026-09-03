import {
  APPROVE_JOIN_COMMAND_TYPE,
  type ApproveJoinCommandData,
  approveJoinCommandDataSchema,
  EXPIRE_JOIN_COMMAND_TYPE,
  type ExpireJoinCommandData,
  expireJoinCommandDataSchema,
  type JoinRequestCommand,
  REJECT_JOIN_COMMAND_TYPE,
  REQUEST_JOIN_COMMAND_TYPE,
  type RejectJoinCommandData,
  type RequestJoinCommandData,
  rejectJoinCommandDataSchema,
  requestJoinCommandDataSchema,
  WITHDRAW_JOIN_COMMAND_TYPE,
  type WithdrawJoinCommandData,
  withdrawJoinCommandDataSchema,
} from "@langwatch/identity-contract";
import type { JoinRequestGuards } from "../join-request-guards";
import type { ZodTypeAny, z } from "zod";
import {
  type Command,
  type CommandHandler,
  defineCommandSchema,
} from "@langwatch/eventing";
import { joinRequestEventsFor } from "../projections/join-request-state.projection";
import type { JoinRequestEvent } from "../projections/join-request-state.projection";

/**
 * The join-request pipeline's five verbs, as the queue's STAGED RE-RUN of
 * each: the same guard the calling path ran, the same envelope. A retried
 * command carries the same commandId, so the re-run costs no second event.
 *
 * Every one is the identical move, so it is written once here rather than
 * five times across five files — the connection pipeline's
 * `ssoConnectionCommands.ts` shape, for the same reason.
 */

type GuardVerb = {
  [K in keyof JoinRequestGuards]: JoinRequestGuards[K] extends (
    data: never,
  ) => Promise<unknown>
    ? K
    : never;
}[keyof JoinRequestGuards];

function joinRequestCommand<Schema extends ZodTypeAny>({
  type,
  schema,
  description,
  verb,
}: {
  type: JoinRequestCommand["type"];
  schema: Schema;
  description: string;
  verb: GuardVerb;
}) {
  type Data = z.infer<Schema>;
  return class JoinRequestCommandHandler
    implements CommandHandler<Command<Data>, JoinRequestEvent>
  {
    static readonly schema = defineCommandSchema(type, schema, description);

    /** The REQUEST is the aggregate — never the organization and never the
     *  user. One request's commands share a lane; two never do. */
    static getAggregateId(payload: { joinRequestId: string }): string {
      return payload.joinRequestId;
    }

    constructor(private readonly guards: JoinRequestGuards) {}

    async handle(command: Command<Data>): Promise<JoinRequestEvent[]> {
      const data = command.data as never;
      const facts = await (
        this.guards[verb] as (input: never) => Promise<never[]>
      )(data);
      return joinRequestEventsFor({
        command: { type, data } as JoinRequestCommand,
        facts,
      });
    }
  };
}

export const RequestJoinCommand = joinRequestCommand({
  type: REQUEST_JOIN_COMMAND_TYPE,
  schema: requestJoinCommandDataSchema,
  description: "Ask an organization on a verified domain to let you in",
  verb: "requestJoin",
});
export type RequestJoinPayload = RequestJoinCommandData;

export const ApproveJoinCommand = joinRequestCommand({
  type: APPROVE_JOIN_COMMAND_TYPE,
  schema: approveJoinCommandDataSchema,
  description:
    "Approve a pending join request — by an admin, the domain policy, or an invitation that answered it",
  verb: "approveJoin",
});
export type ApproveJoinPayload = ApproveJoinCommandData;

export const RejectJoinCommand = joinRequestCommand({
  type: REJECT_JOIN_COMMAND_TYPE,
  schema: rejectJoinCommandDataSchema,
  description: "Reject a pending join request, without recording a reason",
  verb: "rejectJoin",
});
export type RejectJoinPayload = RejectJoinCommandData;

export const WithdrawJoinCommand = joinRequestCommand({
  type: WITHDRAW_JOIN_COMMAND_TYPE,
  schema: withdrawJoinCommandDataSchema,
  description:
    "Withdraw a pending join request — the requester cancelling, or an accepted invitation answering it",
  verb: "withdrawJoin",
});
export type WithdrawJoinPayload = WithdrawJoinCommandData;

export const ExpireJoinCommand = joinRequestCommand({
  type: EXPIRE_JOIN_COMMAND_TYPE,
  schema: expireJoinCommandDataSchema,
  description: "Expire a join request nobody answered inside the window",
  verb: "expireJoin",
});
export type ExpireJoinPayload = ExpireJoinCommandData;
