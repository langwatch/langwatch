import {
  Button,
  Container,
  Heading,
  Html,
  Section,
  Text,
} from "@react-email/components";
import { render } from "@react-email/render";
import { sendEmail } from "./emailSender";

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

const AutomationLimitEmailTemplate = ({
  kind,
  automationName,
  projectName,
  dailyCeiling,
  skippedToday,
  actionUrl,
}: AutomationLimitEmailProps) => {
  const paused = kind === "paused";
  return (
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
            {paused
              ? `We paused "${automationName}"`
              : `"${automationName}" reached its daily limit`}
          </Heading>
          <Text
            style={{
              fontSize: "16px",
              color: "#4b5563",
              lineHeight: 1.5,
              margin: "0 0 16px 0",
            }}
          >
            {paused
              ? `This automation in ${projectName} matched almost every trace in your project, well past its limit of ${dailyCeiling.toLocaleString()} matches a day. We have paused it so it stops creating records you did not intend.`
              : `This automation in ${projectName} matched more traces today than its limit of ${dailyCeiling.toLocaleString()} a day allows, so we stopped acting on the rest for today. It is still switched on, and it starts again tomorrow.`}
          </Text>
          <Text
            style={{
              fontSize: "16px",
              color: "#4b5563",
              lineHeight: 1.5,
              margin: "0 0 16px 0",
            }}
          >
            {skippedToday.toLocaleString()} matches were skipped today.
          </Text>
          <Text
            style={{
              fontSize: "16px",
              color: "#4b5563",
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            {paused
              ? "Narrow its condition so it selects the traces you actually want, then switch it back on."
              : "If this is the volume you expect, narrow the condition so it selects fewer traces, or talk to us about a higher limit on your plan."}
          </Text>
        </Section>

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

        <Section
          style={{
            borderTop: "1px solid #e5e7eb",
            paddingTop: "24px",
          }}
        >
          <Text
            style={{
              fontSize: "14px",
              color: "#6b7280",
              lineHeight: 1.6,
              margin: 0,
            }}
          >
            Questions? Visit the{" "}
            <a
              href="https://docs.langwatch.ai"
              style={{ color: "#ED8926", textDecoration: "none" }}
            >
              Help Center
            </a>{" "}
            or reach out to us. Our support engineers are here to help.
          </Text>
        </Section>
      </Container>
    </Html>
  );
};

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
  await Promise.all(
    to.map((recipient) =>
      sendEmail({
        to: recipient,
        subject: automationLimitEmailSubject(props),
        html,
      }),
    ),
  );
};
