import { createLogger } from "@langwatch/observability";
import { Button, Container, Heading, Html, Section, Text } from "@react-email/components";
import { render } from "@react-email/render";
import { sendEmail } from "../email-sender";
import type { EmailDeliveryPort } from "../providers/types";

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

const BODY_FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/** The two sentences that differ between a throttle and a pause. */
function LimitBody({
  paused,
  automationName,
  projectName,
  dailyCeiling,
  skippedToday,
}: Omit<AutomationLimitEmailProps, "kind" | "actionUrl"> & {
  paused: boolean;
}) {
  const lead = paused
    ? `This automation in ${projectName} matched almost every trace in your project, well past its limit of ${dailyCeiling.toLocaleString()} matches a day. We have paused it so it stops creating records you did not intend.`
    : `This automation in ${projectName} matched more traces today than its limit of ${dailyCeiling.toLocaleString()} a day allows, so we stopped acting on the rest for today. It is still switched on, and it starts again tomorrow.`;
  const advice = paused
    ? "Narrow its condition so it selects the traces you actually want, then switch it back on."
    : "If this is the volume you expect, narrow the condition so it selects fewer traces, or talk to us about a higher limit on your plan.";
  const paragraph = {
    fontSize: "16px",
    color: "#4b5563",
    lineHeight: 1.5,
    margin: "0 0 16px 0",
  } as const;

  return (
    <Section style={{ marginBottom: "24px" }}>
      <Heading
        as="h1"
        style={{
          fontSize: "22px",
          fontWeight: 600,
          color: "#1f2937",
          margin: "0 0 16px 0",
        }}
      >
        {paused ? `We paused "${automationName}"` : `"${automationName}" reached its daily limit`}
      </Heading>
      <Text style={paragraph}>{lead}</Text>
      <Text style={paragraph}>{skippedToday.toLocaleString()} matches were skipped today.</Text>
      <Text style={{ ...paragraph, margin: 0 }}>{advice}</Text>
    </Section>
  );
}

/** Deep link plus the standard support footer. */
function LimitFooter({ actionUrl }: { actionUrl: string }) {
  return (
    <>
      <Section style={{ marginBottom: "32px" }}>
        <Button
          href={actionUrl}
          style={{
            backgroundColor: "#ED8926",
            color: "white",
            padding: "12px 24px",
            textDecoration: "none",
            borderRadius: "6px",
            display: "inline-block",
            fontWeight: 500,
            fontSize: "14px",
          }}
        >
          Open the automation
        </Button>
      </Section>

      <Section style={{ borderTop: "1px solid #e5e7eb", paddingTop: "24px" }}>
        <Text
          style={{
            fontSize: "14px",
            color: "#6b7280",
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          Questions? Visit the{" "}
          <a href="https://docs.langwatch.ai" style={{ color: "#ED8926", textDecoration: "none" }}>
            Help Center
          </a>{" "}
          or reach out to us. Our support engineers are here to help.
        </Text>
      </Section>
    </>
  );
}

const AutomationLimitEmailTemplate = ({ kind, actionUrl, ...body }: AutomationLimitEmailProps) => (
  <Html lang="en" dir="ltr">
    <Container
      style={{
        fontFamily: BODY_FONT,
        maxWidth: "600px",
        margin: "0 auto",
        backgroundColor: "#ffffff",
        padding: "40px 20px",
      }}
    >
      <LimitBody paused={kind === "paused"} {...body} />
      <LimitFooter actionUrl={actionUrl} />
    </Container>
  </Html>
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
  mailer,
  to,
  ...props
}: AutomationLimitEmailProps & { to: string[]; mailer: EmailDeliveryPort }) => {
  const html = await renderAutomationLimitEmail(props);
  const results = await Promise.allSettled(
    to.map((recipient) =>
      sendEmail({
        mailer,
        content: {
          to: recipient,
          subject: automationLimitEmailSubject(props),
          html,
        },
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
  const kinds = [...new Set(failures.map((failure) => failureKind(failure.reason)))].sort();
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
