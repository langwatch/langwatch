import type { EventingCommandSender } from "@langwatch/eventing";

import type { RecordMemberOffboardedCommandData } from "../eventing/authz-member-offboarded.events.ts";

type MemberOffboardedSender = Pick<
  EventingCommandSender<RecordMemberOffboardedCommandData>,
  "send"
>;

/** Records `lw.authz.member_offboarded` once a proven offboarding has taken the seat. */
export class AuthzMemberOffboardedNoticeService {
  static create({
    now = Date.now,
  }: { now?: () => number } = {}): AuthzMemberOffboardedNoticeService {
    return new AuthzMemberOffboardedNoticeService(now);
  }

  #sender: MemberOffboardedSender | undefined;

  private constructor(private readonly now: () => number) {}

  connect(sender: MemberOffboardedSender): void {
    this.#sender = sender;
  }

  async memberOffboarded(
    input: Readonly<{ organizationId: string; userId: string; offboardedByUserId: string | null }>,
  ): Promise<void> {
    const sender = this.#sender;
    if (!sender) throw new Error("authz_member_offboarded is not registered in this process");
    await sender.send({ ...input, tenantId: input.organizationId, occurredAt: this.now() });
  }
}

/** What the offboarding service needs of the notice. */
export type AuthzMemberOffboardedNotice = Pick<
  AuthzMemberOffboardedNoticeService,
  "memberOffboarded"
>;
