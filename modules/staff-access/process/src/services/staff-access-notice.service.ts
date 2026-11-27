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
 * Staff access emails: every other platform operator hears what one operator did, and an agent's
 * owner hears that a request waits for them. A failed send is logged and never undoes the action.
 */
export class StaffAccessNoticeService {
  private constructor(private readonly deps: StaffAccessNoticeDeps) {}

  static create(deps: StaffAccessNoticeDeps): StaffAccessNoticeService {
    return new StaffAccessNoticeService(deps);
  }

  /** Every platform operator except the one who acted. */
  tellOtherOperators({
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
    return this.send({
      actingUserId,
      subject,
      lines,
      idempotencyKey,
      recipients: (operator) => operator.userId !== actingUserId,
    });
  }

  /** The operator who owns the agent: a request is waiting for their passkey. */
  tellOwner({
    ownerUserId,
    subject,
    lines,
    idempotencyKey,
  }: {
    ownerUserId: string;
    subject: string;
    lines: readonly NoticeLine[];
    idempotencyKey: string;
  }): Promise<void> {
    return this.send({
      actingUserId: ownerUserId,
      subject,
      lines,
      idempotencyKey,
      recipients: (operator) => operator.userId === ownerUserId,
    });
  }

  private async send({
    actingUserId,
    subject,
    lines,
    idempotencyKey,
    recipients,
  }: {
    actingUserId: string;
    subject: string;
    lines: readonly NoticeLine[];
    idempotencyKey: string;
    recipients: (operator: { userId: string }) => boolean;
  }): Promise<void> {
    try {
      const operators = await this.deps.ops.listPlatformOperators();
      const acting = operators.find((operator) => operator.userId === actingUserId);
      const chosen = operators.filter((operator) => recipients(operator) && operator.email);
      if (chosen.length === 0) return;
      const rendered = await this.deps.renderer.renderStaffAccessNotice({
        headline: subject,
        operatorName: acting?.name ?? acting?.email ?? actingUserId,
        details: [...lines],
      });
      await Promise.all(
        chosen.map((operator) =>
          this.deps.notifications.sendEmail({
            to: operator.email ?? "",
            subject: rendered.subject,
            html: rendered.html,
            idempotencyKey: `${idempotencyKey}:${operator.userId}`,
          }),
        ),
      );
    } catch (error) {
      logger.warn({ error, subject }, "a staff access notice was not sent");
    }
  }
}
