import { MailRender } from "../ports/mail-render.port.ts";
import {
  renderJoinRequestExpiredEmail,
  renderJoinRequestReminderEmail,
} from "../templates/join-request-emails.tsx";
import {
  renderTriggerDigestEmail,
  type TriggerDigestMail,
} from "../templates/trigger-digest-email.tsx";

/**
 * The only place react-email is evaluated on backend; composition boundary
 * enforced by frontend-boundary tests to keep React off send-only processes.
 */
export class ReactEmailMailRenderer extends MailRender {
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
