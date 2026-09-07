import {
  APPROVE_JOIN_COMMAND_TYPE,
  type ApproveJoinCommandData,
  EXPIRE_JOIN_COMMAND_TYPE,
  type ExpireJoinCommandData,
  isPublicEmailDomain,
  JOIN_APPROVED_EVENT_TYPE,
  JOIN_EXPIRED_EVENT_TYPE,
  JOIN_REJECTED_EVENT_TYPE,
  JOIN_REQUESTED_EVENT_TYPE,
  JOIN_WITHDRAWN_EVENT_TYPE,
  type JoinRequestAggregateState,
  type JoinRequestCommandType,
  type JoinRequestFactInput,
  type JoinRequestState,
  JoinNotAvailableError,
  JoinRequestAlreadyPendingError,
  JoinRequestNotPendingError,
  normalizeDomain,
  REJECT_JOIN_COMMAND_TYPE,
  REQUEST_JOIN_COMMAND_TYPE,
  type RejectJoinCommandData,
  type RequestJoinCommandData,
  WITHDRAW_JOIN_COMMAND_TYPE,
  type WithdrawJoinCommandData,
} from "@langwatch/identity";
import type { JoinRequestReadRepository } from "./join-request.repository";

/**
 * The join-request guards (ADR-117, D12): what runs BEFORE any fact exists.
 * Each verb reads the request's FOLDED STATE, refuses what the lifecycle
 * forbids, and states only what the state does not already carry.
 *
 * One implementation, two callers — `JoinRequestService` on the calling path
 * and the pipeline's command handlers on the staged re-run — so the guard
 * that vetoes a live command is the one the queue's re-run applies. That is
 * what makes a replayed approval cost one membership: the re-run reads a
 * request that is already APPROVED and states nothing.
 *
 * What this file does NOT decide is who is allowed to click. Authority is the
 * boundary's job (`organization:manage`, the same permission that gates
 * inviting); the guard's job is the state machine and the domain rules.
 *
 * Facts come back without their envelope; the ledger stamps business time,
 * tenancy and idempotency from the command that produced them.
 */

/** Which states each verb may be commanded from. The one place the diagram
 *  in `specs/identity/join-requests.feature` is executable. PENDING is the
 *  only state anything can be done from, and the empty list is "no state at
 *  all" — a request that does not exist yet. */
const ALLOWED_FROM: Record<
  JoinRequestCommandType,
  readonly JoinRequestState[]
> = {
  [REQUEST_JOIN_COMMAND_TYPE]: [],
  [APPROVE_JOIN_COMMAND_TYPE]: ["PENDING"],
  [REJECT_JOIN_COMMAND_TYPE]: ["PENDING"],
  [WITHDRAW_JOIN_COMMAND_TYPE]: ["PENDING"],
  [EXPIRE_JOIN_COMMAND_TYPE]: ["PENDING"],
};

export interface JoinRequestGuardsDeps {
  requests: JoinRequestReadRepository;
}

export class JoinRequestGuards {
  private readonly requests: JoinRequestReadRepository;

  constructor(deps: JoinRequestGuardsDeps) {
    this.requests = deps.requests;
  }

  /**
   * Ask to join.
   *
   * Two refusals and one silence. A second ask for a request that already
   * exists states nothing at all — the caller minted the same id, so this is
   * a retry rather than a duplicate. A DIFFERENT request while one is open is
   * `join_request_already_pending`; a public email domain is
   * `join_not_available`, the same nothing every other closed door gives.
   */
  async requestJoin(
    data: RequestJoinCommandData,
  ): Promise<JoinRequestFactInput[]> {
    const existing = await this.requests.findRequest({
      joinRequestId: data.joinRequestId,
    });
    // The retry leg: the same command id names the same aggregate, and a
    // second pass costs no event.
    if (existing) return [];

    const domain = normalizeDomain(data.domain);
    // Structural, not probabilistic, and enforced here as well as at the
    // matcher: a consumer mail provider is not a company, and one match on
    // one would offer strangers to each other by the million.
    if (isPublicEmailDomain(domain)) {
      throw new JoinNotAvailableError(
        `join request refused: ${domain} is a public email domain`,
      );
    }

    const open = await this.requests.findPendingRequest({
      userId: data.userId,
      organizationId: data.organizationId,
    });
    if (open) {
      throw new JoinRequestAlreadyPendingError(
        `user ${data.userId} already has a pending request to ${data.organizationId}`,
      );
    }

    return [
      {
        type: JOIN_REQUESTED_EVENT_TYPE,
        data: {
          joinRequestId: data.joinRequestId,
          userId: data.userId,
          organizationId: data.organizationId,
          domain,
          matchedVia: data.matchedVia,
          expiresAtMs: data.expiresAtMs,
          actor: data.actor,
        },
      },
    ];
  }

  /**
   * Approve — by an admin, by the auto-join policy, or by an invitation that
   * answered the request. There is no role on this command and never will be:
   * an approval grants the organization's default role, and an admin who
   * wants to hand over more sends a formal invitation instead.
   */
  async approveJoin(
    data: ApproveJoinCommandData,
  ): Promise<JoinRequestFactInput[]> {
    const held = await this.requests.findRequest({
      joinRequestId: data.joinRequestId,
    });
    // The retry leg, and the reason an approval is safe to re-run: an
    // approval that already landed from the SAME resolver states nothing
    // rather than refusing. The membership attach behind it is idempotent
    // too, so a retry after a partial failure finishes the job instead of
    // leaving a request approved with nobody in the organization.
    if (
      held?.state === "APPROVED" &&
      held.resolvedByType === data.resolvedBy.type &&
      held.resolvedById === data.resolvedBy.id
    ) {
      return [];
    }
    const state = await this.pendingOrRefuse({
      joinRequestId: data.joinRequestId,
      verb: APPROVE_JOIN_COMMAND_TYPE,
    });
    if (!state) return [];
    return [
      {
        type: JOIN_APPROVED_EVENT_TYPE,
        data: {
          joinRequestId: data.joinRequestId,
          resolvedBy: data.resolvedBy,
          actor: data.actor,
        },
      },
    ];
  }

  /** Reject. No reason field: a rejection an admin has to justify is one they
   *  hesitate to make, and the requester is told only that it was not
   *  approved. */
  async rejectJoin(
    data: RejectJoinCommandData,
  ): Promise<JoinRequestFactInput[]> {
    const state = await this.pendingOrRefuse({
      joinRequestId: data.joinRequestId,
      verb: REJECT_JOIN_COMMAND_TYPE,
    });
    if (!state) return [];
    return [
      {
        type: JOIN_REJECTED_EVENT_TYPE,
        data: {
          joinRequestId: data.joinRequestId,
          resolvedBy: data.resolvedBy,
          actor: data.actor,
        },
      },
    ];
  }

  /** Withdraw — the requester giving up, or an accepted invitation answering
   *  the request from the other direction, so a person never holds both. */
  async withdrawJoin(
    data: WithdrawJoinCommandData,
  ): Promise<JoinRequestFactInput[]> {
    const state = await this.pendingOrRefuse({
      joinRequestId: data.joinRequestId,
      verb: WITHDRAW_JOIN_COMMAND_TYPE,
    });
    if (!state) return [];
    return [
      {
        type: JOIN_WITHDRAWN_EVENT_TYPE,
        data: {
          joinRequestId: data.joinRequestId,
          cause: data.cause,
          actor: data.actor,
        },
      },
    ];
  }

  /**
   * Expire, dispatched by the day-14 wake.
   *
   * The guard re-reads the folded deadline, so a wake that fires early — a
   * lagged queue, a replayed job — expires nothing. The process manager
   * decides WHEN; this still decides whether.
   */
  async expireJoin(data: ExpireJoinCommandData): Promise<JoinRequestFactInput[]> {
    const state = await this.requests.findRequest({
      joinRequestId: data.joinRequestId,
    });
    // A request that already ended, by any of the other four routes, has
    // nothing left to expire. Silence rather than a refusal: nobody is
    // waiting on this answer, and a wake is not a person to tell.
    if (!state || state.state !== "PENDING") return [];
    if (state.expiresAtMs !== null && data.scheduledFor < state.expiresAtMs) {
      return [];
    }
    return [
      {
        type: JOIN_EXPIRED_EVENT_TYPE,
        data: { joinRequestId: data.joinRequestId, actor: data.actor },
      },
    ];
  }

  /**
   * The shared read: the request as it stands, refused unless PENDING.
   *
   * A request that does not exist is NOT refused here — it is answered with
   * `null`, meaning "state nothing". Whether that is a 404 the caller sees is
   * the boundary's decision, and the boundary is the only place that knows
   * whether the asker was allowed to know the request exists at all.
   */
  private async pendingOrRefuse({
    joinRequestId,
    verb,
  }: {
    joinRequestId: string;
    verb: JoinRequestCommandType;
  }): Promise<JoinRequestAggregateState | null> {
    const state = await this.requests.findRequest({ joinRequestId });
    if (!state) return null;
    if (!ALLOWED_FROM[verb].includes(state.state)) {
      throw new JoinRequestNotPendingError(
        `${verb} refused: request ${joinRequestId} is ${state.state}`,
      );
    }
    return state;
  }
}
