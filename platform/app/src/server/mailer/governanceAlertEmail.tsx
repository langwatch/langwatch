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

export interface GovernanceAlertEmailProps {
  monitorName: string;
  ruleName: string;
  source: string;
  windowStartIso: string;
  windowEndIso: string;
  dashboardUrl: string;
}

const GovernanceAlertEmail = (props: GovernanceAlertEmailProps) => (
  <Html lang="en" dir="ltr">
    <Container
      style={{
        fontFamily:
          "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        maxWidth: "600px",
        margin: "0 auto",
        padding: "32px 20px",
      }}
    >
      <Heading as="h1" style={{ fontSize: "22px" }}>
        Governance alert
      </Heading>
      <Section>
        <Text>Monitor: {props.monitorName}</Text>
        <Text>Rule: {props.ruleName}</Text>
        <Text>Source: {props.source}</Text>
        <Text>
          Window: {props.windowStartIso} – {props.windowEndIso}
        </Text>
      </Section>
      <Button
        href={props.dashboardUrl}
        style={{
          backgroundColor: "#ED8926",
          color: "white",
          padding: "12px 20px",
          textDecoration: "none",
          borderRadius: "6px",
        }}
      >
        Open governance dashboard
      </Button>
    </Container>
  </Html>
);

export const renderGovernanceAlertEmail = (props: GovernanceAlertEmailProps) =>
  render(<GovernanceAlertEmail {...props} />);

export const sendGovernanceAlertEmail = async ({
  to,
  ...props
}: GovernanceAlertEmailProps & { to: string }): Promise<void> => {
  const html = await renderGovernanceAlertEmail(props);
  await sendEmail({
    to,
    subject: `Governance alert: ${props.ruleName}`,
    html,
  });
};
