import type { JoinRequestNotifierService } from "../../join-request/services/join-request-notifier.service.ts";
import type { SsoArrivalNotifications } from "../rules/sso-arrival-contract.rules.ts";

type JoinedAutomatically = Parameters<SsoArrivalNotifications["joinedAutomatically"]>[0];

/**
 * The administrators' notice an automatic single sign-on admission owes, sent through the
 * join-request notifier as main's EmailJoinRequestNotifier did (one per admission).
 */
export class SsoArrivalNoticeService implements SsoArrivalNotifications {
  static create(deps: {
    notifier: Pick<JoinRequestNotifierService, "joinedAutomatically">;
  }): SsoArrivalNoticeService {
    return new SsoArrivalNoticeService(deps);
  }

  private constructor(
    private readonly deps: { notifier: Pick<JoinRequestNotifierService, "joinedAutomatically"> },
  ) {}

  async joinedAutomatically({
    organizationId,
    requesterUserId,
    domain,
    admissionId,
  }: JoinedAutomatically): Promise<void> {
    // Main's key: the admission's grant, or the one membership a Developer seat is.
    const joinRequestId = admissionId ?? `automatic:${organizationId}:${requesterUserId}:${domain}`;
    await this.deps.notifier.joinedAutomatically({
      joinRequestId,
      organizationId,
      requesterUserId,
      domain,
    });
  }

  /** Lifecycle messaging is nurturing's to subscribe to (rule 7); identity calls no such tool. */
  startNurturing(): void {}
}
