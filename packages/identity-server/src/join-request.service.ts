import {
  APPROVE_JOIN_COMMAND_TYPE,
  type ApproveJoinCommandData,
  approveJoinCommandDataSchema,
  EXPIRE_JOIN_COMMAND_TYPE,
  type ExpireJoinCommandData,
  expireJoinCommandDataSchema,
  type JoinRequestCommand,
  type JoinRequestFact,
  type JoinRequestFactInput,
  REJECT_JOIN_COMMAND_TYPE,
  REQUEST_JOIN_COMMAND_TYPE,
  type RejectJoinCommandData,
  type RequestJoinCommandData,
  rejectJoinCommandDataSchema,
  requestJoinCommandDataSchema,
  WITHDRAW_JOIN_COMMAND_TYPE,
  type WithdrawJoinCommandData,
  withdrawJoinCommandDataSchema,
} from "@langwatch/identity";
import type { JoinRequestGuards } from "./join-request-guards";
import type { JoinRequestLedger } from "./join-request-ledger";

/**
 * The join-request write surface (D12): five verbs, each the same move —
 * parse the input, run the guard, hand the command and its facts to the
 * ledger.
 *
 * There is no other way to change a request. The sign-up interstitial, the
 * members area, the auto-join policy and the expiry wake all call these
 * methods; nothing anywhere writes a `JoinRequest` row directly, because the
 * row is a projection of this log and a hand-written one would be overwritten
 * by the next fold or the next replay.
 *
 * Membership is NOT written here, in any verb. An approval states that the
 * request was approved and nothing more; attaching the grant is the app's
 * job, on the ledger that already owns every other membership. That split is
 * what puts a join approval on the customer's audit page beside an invitation
 * acceptance rather than in a history of its own.
 */
export class JoinRequestService {
  constructor(
    private readonly guards: JoinRequestGuards,
    private readonly ledger: JoinRequestLedger,
  ) {}

  async requestJoin(input: RequestJoinCommandData): Promise<JoinRequestFact[]> {
    const data = requestJoinCommandDataSchema.parse(input);
    return this.commit(
      { type: REQUEST_JOIN_COMMAND_TYPE, data },
      await this.guards.requestJoin(data),
    );
  }

  async approveJoin(input: ApproveJoinCommandData): Promise<JoinRequestFact[]> {
    const data = approveJoinCommandDataSchema.parse(input);
    return this.commit(
      { type: APPROVE_JOIN_COMMAND_TYPE, data },
      await this.guards.approveJoin(data),
    );
  }

  async rejectJoin(input: RejectJoinCommandData): Promise<JoinRequestFact[]> {
    const data = rejectJoinCommandDataSchema.parse(input);
    return this.commit(
      { type: REJECT_JOIN_COMMAND_TYPE, data },
      await this.guards.rejectJoin(data),
    );
  }

  async withdrawJoin(
    input: WithdrawJoinCommandData,
  ): Promise<JoinRequestFact[]> {
    const data = withdrawJoinCommandDataSchema.parse(input);
    return this.commit(
      { type: WITHDRAW_JOIN_COMMAND_TYPE, data },
      await this.guards.withdrawJoin(data),
    );
  }

  async expireJoin(input: ExpireJoinCommandData): Promise<JoinRequestFact[]> {
    const data = expireJoinCommandDataSchema.parse(input);
    return this.commit(
      { type: EXPIRE_JOIN_COMMAND_TYPE, data },
      await this.guards.expireJoin(data),
    );
  }

  /** A guard that stated nothing costs no append: the retry legs and the
   *  wakes that fired early both land here. */
  private async commit(
    command: JoinRequestCommand,
    facts: JoinRequestFactInput[],
  ): Promise<JoinRequestFact[]> {
    if (facts.length === 0) return [];
    return this.ledger.commit({ command, facts });
  }
}
