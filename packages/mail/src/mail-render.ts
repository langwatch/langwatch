import type { DigestCodingAgentWeekProps } from "./templates/digest-coding-agent-week.tsx";
import type { DigestPlanPressureProps } from "./templates/digest-plan-pressure.tsx";
import type { DigestScenariosTrendProps } from "./templates/digest-scenarios-trend.tsx";
import type { DigestTracesWeekProps } from "./templates/digest-traces-week.tsx";
import type { MonitorAutoPausedEmailProps } from "./templates/monitor-auto-paused-email.tsx";
import type { PlatformOperatorChangeEmailProps } from "./templates/platform-operator-change-email.tsx";
import type { StaffAccessNoticeEmailProps } from "./templates/staff-access-notice-email.tsx";
import type { TriggerDigestMail } from "./templates/trigger-digest-email.tsx";
import type { UpgradeAlertEmailProps } from "./templates/upgrade-alert-email.tsx";

/**
 * The messages a backend process asks to render. Abstract class
 * allows type-safe dependency injection with test substitution, keeping react-email
 * off worker boot graphs.
 */
export abstract class MailRender {
  /**
   * The digest an automation sends when its author wrote no template of their
   * own — which is most automations.
   */
  abstract renderTriggerDigest(input: TriggerDigestMail): Promise<string>;

  /** The one nudge sent to admins on the seventh day a join request waits. */
  abstract renderJoinRequestReminder(input: {
    organizationName: string;
    requesterName: string;
    membersSettingsUrl: string;
  }): Promise<string>;

  /** The quiet notice a requester gets when nobody answered in two weeks. */
  abstract renderJoinRequestExpiry(input: { organizationName: string }): Promise<string>;

  /** What went wrong with an upgrade, sent to each of the installation's platform operators. */
  abstract renderUpgradeAlert(
    input: UpgradeAlertEmailProps,
  ): Promise<{ subject: string; html: string }>;

  /** An online evaluation that paused itself, sent to each of its organization's admins. */
  abstract renderMonitorAutoPaused(
    input: MonitorAutoPausedEmailProps,
  ): Promise<{ subject: string; html: string }>;

  /** What one platform operator did with staff access, sent to each of the other operators. */
  abstract renderStaffAccessNotice(
    input: StaffAccessNoticeEmailProps,
  ): Promise<{ subject: string; html: string }>;

  /** Someone was given or lost the platform-operator role, sent to every operator. */
  abstract renderPlatformOperatorChange(
    input: PlatformOperatorChangeEmailProps,
  ): Promise<{ subject: string; html: string }>;

  /** An admin's weekly digest when the month's usage presses on the plan limit. */
  abstract renderDigestPlanPressure(
    input: DigestPlanPressureProps,
  ): Promise<{ subject: string; html: string }>;

  /** A member's weekly digest when the focus project's scenario failure rate moved. */
  abstract renderDigestScenariosTrend(
    input: DigestScenariosTrendProps,
  ): Promise<{ subject: string; html: string }>;

  /** A person's weekly digest of their own coding-agent sessions. */
  abstract renderDigestCodingAgentWeek(
    input: DigestCodingAgentWeekProps,
  ): Promise<{ subject: string; html: string }>;

  /** A member's weekly digest of the focus project's traces. */
  abstract renderDigestTracesWeek(
    input: DigestTracesWeekProps,
  ): Promise<{ subject: string; html: string }>;
}
