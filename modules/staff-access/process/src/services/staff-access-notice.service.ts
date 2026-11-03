import type { MailRender } from "@langwatch/mail";
import type { NotificationService } from "@langwatch/notification-contract";
import { createLogger } from "@langwatch/observability";
import type { OpsApi } from "@langwatch/ops-contract";

const logger = createLogger("langwatch:staff-access:notice");

/** One line of the notice: a label and the plain value it shows. */
type NoticeLine = Readonly<{ label: string; value: string }>;

type StaffAccessNoticeDeps = {
  ops: Pick<OpsApi, "listPlatformOperators">;
  notifications: Pick<NotificationService, "sendEmail">;
  renderer: Pick<MailRender, "renderStaffAccessNotice">;
};

/**
 * Tells every other platform operator what one operator just did with staff access, so no
 * enrolment or approval goes unseen. A failed send is logged and never undoes the action.
 */
export class StaffAccessNoticeService {
  private constructor(private readonly deps: StaffAccessNoticeDeps) {}

  static create(deps: StaffAccessNoticeDeps): StaffAccessNoticeService {
    return new StaffAccessNoticeService(deps);
  }

  async tellOtherOperators({
    actingUserId,
    subject,
    lines,
    idempotencyKey,
  }: {
    actingUserId: string;
    subject: string;
    lines: readonly NoticeLine[];
    idempotencyKey: string;
  }): Promise<void> {
    try {
      const operators = await this.deps.ops.listPlatformOperators();
      const acting = operators.find((operator) => operator.userId === actingUserId);
      const others = operators.filter(
        (operator) => operator.userId !== actingUserId && operator.email,
      );
      if (others.length === 0) return;
      const rendered = await this.deps.renderer.renderStaffAccessNotice({
        headline: subject,
        operatorName: acting?.name ?? acting?.email ?? actingUserId,
        details: [...lines],
      });
      await Promise.all(
        others.map((operator) =>
          this.deps.notifications.sendEmail({
            to: operator.email ?? "",
            subject: rendered.subject,
            html: rendered.html,
            idempotencyKey: `${idempotencyKey}:${operator.userId}`,
          }),
        ),
      );
    } catch (error) {
      logger.warn({ error, subject }, "the staff access notice to other operators was not sent");
    }
  }
}
