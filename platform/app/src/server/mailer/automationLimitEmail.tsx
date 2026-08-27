import { createLogger } from "@langwatch/observability";
import { render } from "@react-email/render";
import {
  EmailAction,
  EmailCallout,
  EmailFinePrint,
  EmailParagraph,
  EmailShell,
  emailLinkStyle,
} from "./emailLayout";
import { sendEmail } from "./emailSender";
import { EMAIL_COLOR } from "./emailTheme";

const logger = createLogger("langwatch:mailer:automationLimitEmail");

export type AutomationLimitKind = "ceiling_reached" | "paused";

interface AutomationLimitEmailProps {
  kind: AutomationLimitKind;
  automationName: string;
  projectName: string;
  /** Confirmed matches this automation is allowed to act on per day. */
  dailyCeiling: number;
  /** Confirmed matches it dropped today, at the moment the mail was queued. */
  skippedToday: number;
  actionUrl: string;
}

/** The two sentences that differ between a throttle and a pause. */
function LimitBody({
  paused,
  projectName,
  dailyCeiling,
  skippedToday,
}: Omit<AutomationLimitEmailProps, "kind" | "actionUrl" | "automationName"> & {
  paused: boolean;
}) {
  const lead = paused
    ? `This automation in ${projectName} matched almost every trace in your project, well past its limit of ${dailyCeiling.toLocaleString()} matches a day. We have paused it so it stops creating records you did not intend.`
    : `This automation in ${projectName} matched more traces today than its limit of ${dailyCeiling.toLocaleString()} a day allows, so we stopped acting on the rest for today. It is still switched on, and it starts again tomorrow.`;
  const advice = paused
    ? "Narrow its condition so it selects the traces you actually want, then switch it back on."
    : "If this is the volume you expect, narrow the condition so it selects fewer traces, or talk to us about a higher limit on your plan.";

  return (
    <>
      <EmailParagraph>{lead}</EmailParagraph>
      <EmailCallout>
        <EmailParagraph
          style={{ margin: 0, color: EMAIL_COLOR.accentText, fontWeight: 500 }}
        >
          {skippedToday.toLocaleString()} matches were skipped today.
        </EmailParagraph>
      </EmailCallout>
      <EmailParagraph>{advice}</EmailParagraph>
    </>
  );
}

/** The standard support footer, in the quietest voice on the card. */
function LimitFooter() {
  return (
    <EmailFinePrint>
      Questions? Visit the{" "}
      <a href="https://docs.langwatch.ai" style={emailLinkStyle}>
        Help Center
      </a>{" "}
      or reach out to us. Our support engineers are here to help.
    </EmailFinePrint>
  );
}

const AutomationLimitEmailTemplate = ({
  kind,
  actionUrl,
  automationName,
  ...body
}: AutomationLimitEmailProps) => (
  <EmailShell
    title={
      kind === "paused"
        ? `We paused "${automationName}"`
        : `"${automationName}" reached its daily limit`
    }
    footer={<LimitFooter />}
  >
    <LimitBody paused={kind === "paused"} {...body} />
    <EmailAction href={actionUrl} label="Open the automation" />
  </EmailShell>
);

export const renderAutomationLimitEmail = (props: AutomationLimitEmailProps) =>
  render(<AutomationLimitEmailTemplate {...props} />);

export const automationLimitEmailSubject = ({
  kind,
  automationName,
}: Pick<AutomationLimitEmailProps, "kind" | "automationName">): string =>
  kind === "paused"
    ? `Automation paused: ${automationName}`
    : `Automation reached its daily limit: ${automationName}`;

export const sendAutomationLimitEmail = async ({
  to,
  ...props
}: AutomationLimitEmailProps & { to: string[] }) => {
  const html = await renderAutomationLimitEmail(props);
  const results = await Promise.allSettled(
    to.map((recipient) =>
      sendEmail({
        to: recipient,
        subject: automationLimitEmailSubject(props),
        html,
      }),
    ),
  );

  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length === 0) return;

  // The sends are independent, so one unroutable admin address must not decide
  // that the rest of the organization hears nothing. Only a batch where nothing
  // landed is a failure worth reporting upward, because the caller answers that
  // by trying again, and trying again would mail the admins who did receive it
  // a second time.
  const kinds = [
    ...new Set(failures.map((failure) => failureKind(failure.reason))),
  ].sort();
  if (failures.length === to.length) {
    throw new Error(
      `Could not send the automation limit email to any of its ${to.length} ` +
        `recipients (${kinds.join(", ")})`,
    );
  }

  logger.warn(
    { failed: failures.length, recipients: to.length, kinds },
    "Some automation limit emails could not be sent",
  );
};

/**
 * A provider failure reduced to something safe to write down.
 *
 * A rejection message from a mail provider routinely quotes the envelope back,
 * as in `550 5.1.1 <someone@example.com>: recipient rejected`, so the message
 * carries the recipient's address into any log or exception that repeats it.
 * The code or SMTP status is the part that tells an operator what went wrong,
 * and it names no one.
 */
function failureKind(reason: unknown): string {
  if (typeof reason === "object" && reason !== null) {
    const { code, responseCode } = reason as {
      code?: unknown;
      responseCode?: unknown;
    };
    if (typeof code === "string" && code !== "") return code;
    if (typeof responseCode === "number") return `smtp_${responseCode}`;
  }
  return reason instanceof Error ? reason.name : "unknown";
}
