import type { NotificationService } from "@langwatch/notification-contract";
import { createLogger } from "@langwatch/observability";
import type { OpsApi } from "@langwatch/ops-contract";

const logger = createLogger("langwatch:staff-access:notice");

/** One line of the notice: a label and the plain value it shows. */
type NoticeLine = Readonly<{ label: string; value: string }>;

/**
 * Tells every other platform operator what one operator just did with staff access, so no
 * enrolment or approval goes unseen. A failed send is logged and never undoes the action.
 */
export class StaffAccessNoticeService {
  private constructor(
    private readonly deps: {
      ops: Pick<OpsApi, "listPlatformOperators">;
      notifications: Pick<NotificationService, "sendEmail">;
    },
  ) {}

  static create(deps: {
    ops: Pick<OpsApi, "listPlatformOperators">;
    notifications: Pick<NotificationService, "sendEmail">;
  }): StaffAccessNoticeService {
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
      const actingName = acting?.name ?? acting?.email ?? actingUserId;
      const rows = [{ label: "Operator", value: actingName }, ...lines]
        .map(
          ({ label, value }) =>
            `<tr><th align="left">${escape(label)}</th><td>${escape(value)}</td></tr>`,
        )
        .join("");
      const html = `<p>${escape(subject)}</p><table>${rows}</table>`;
      await Promise.all(
        others.map((operator) =>
          this.deps.notifications.sendEmail({
            to: operator.email ?? "",
            subject,
            html,
            idempotencyKey: `${idempotencyKey}:${operator.userId}`,
          }),
        ),
      );
    } catch (error) {
      logger.warn({ error, subject }, "the staff access notice to other operators was not sent");
    }
  }
}

function escape(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
