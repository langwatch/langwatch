import { MailRenderPort } from "../ports/mail-render.port";
import {
  renderJoinRequestExpiredEmail,
  renderJoinRequestReminderEmail,
} from "../templates/join-request-emails";
import {
  renderTriggerDigestEmail,
  type TriggerDigestMail,
} from "../templates/trigger-digest-email";

/**
 * The one renderer, and the only place react-email is evaluated on a backend
 * graph.
 *
 * `frontend-boundary.unit.test.ts` walks the value-import graph from every
 * process entrypoint and composition to the browser-only packages, and stops
 * on entry to `@langwatch/mail`. That terminal is what this class is for: a
 * composition root names it, the walk stops, and React stays off the graph of
 * every process that merely sends mail.
 */
export class ReactEmailMailRenderer extends MailRenderPort {
  static create(): ReactEmailMailRenderer {
    return new ReactEmailMailRenderer();
  }

  private constructor() {
    super();
  }

  renderTriggerDigest(input: TriggerDigestMail): Promise<string> {
    return renderTriggerDigestEmail(input);
  }

  renderJoinRequestReminder(input: {
    organizationName: string;
    requesterName: string;
    membersSettingsUrl: string;
  }): Promise<string> {
    return renderJoinRequestReminderEmail(input);
  }

  renderJoinRequestExpiry(input: { organizationName: string }): Promise<string> {
    return renderJoinRequestExpiredEmail(input);
  }
}
