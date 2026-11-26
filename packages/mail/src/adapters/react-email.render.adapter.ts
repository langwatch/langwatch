import { MailRender } from "../mail-render.ts";
import {
  type DigestCodingAgentWeekProps,
  renderDigestCodingAgentWeekEmail,
} from "../templates/digest-coding-agent-week.tsx";
import {
  type DigestPlanPressureProps,
  renderDigestPlanPressureEmail,
} from "../templates/digest-plan-pressure.tsx";
import {
  type DigestScenariosTrendProps,
  renderDigestScenariosTrendEmail,
} from "../templates/digest-scenarios-trend.tsx";
import {
  type DigestTracesWeekProps,
  renderDigestTracesWeekEmail,
} from "../templates/digest-traces-week.tsx";
import {
  renderJoinRequestExpiredEmail,
  renderJoinRequestReminderEmail,
} from "../templates/join-request-emails.tsx";
import {
  type MonitorAutoPausedEmailProps,
  renderMonitorAutoPausedEmail,
} from "../templates/monitor-auto-paused-email.tsx";
import {
  type PlatformOperatorChangeEmailProps,
  renderPlatformOperatorChangeEmail,
} from "../templates/platform-operator-change-email.tsx";
import {
  renderStaffAccessNoticeEmail,
  type StaffAccessNoticeEmailProps,
} from "../templates/staff-access-notice-email.tsx";
import {
  renderTriggerDigestEmail,
  type TriggerDigestMail,
} from "../templates/trigger-digest-email.tsx";
import {
  renderUpgradeAlertEmail,
  type UpgradeAlertEmailProps,
} from "../templates/upgrade-alert-email.tsx";

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

  renderUpgradeAlert(input: UpgradeAlertEmailProps): Promise<{ subject: string; html: string }> {
    return renderUpgradeAlertEmail(input);
  }

  renderMonitorAutoPaused(
    input: MonitorAutoPausedEmailProps,
  ): Promise<{ subject: string; html: string }> {
    return renderMonitorAutoPausedEmail(input);
  }

  renderStaffAccessNotice(
    input: StaffAccessNoticeEmailProps,
  ): Promise<{ subject: string; html: string }> {
    return renderStaffAccessNoticeEmail(input);
  }

  renderPlatformOperatorChange(
    input: PlatformOperatorChangeEmailProps,
  ): Promise<{ subject: string; html: string }> {
    return renderPlatformOperatorChangeEmail(input);
  }

  renderDigestPlanPressure(
    input: DigestPlanPressureProps,
  ): Promise<{ subject: string; html: string }> {
    return renderDigestPlanPressureEmail(input);
  }

  renderDigestScenariosTrend(
    input: DigestScenariosTrendProps,
  ): Promise<{ subject: string; html: string }> {
    return renderDigestScenariosTrendEmail(input);
  }

  renderDigestCodingAgentWeek(
    input: DigestCodingAgentWeekProps,
  ): Promise<{ subject: string; html: string }> {
    return renderDigestCodingAgentWeekEmail(input);
  }

  renderDigestTracesWeek(input: DigestTracesWeekProps): Promise<{ subject: string; html: string }> {
    return renderDigestTracesWeekEmail(input);
  }
}
