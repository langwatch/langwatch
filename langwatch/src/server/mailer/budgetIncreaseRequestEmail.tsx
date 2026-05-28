import { Button } from "@react-email/button";
import { Container } from "@react-email/container";
import { Heading } from "@react-email/heading";
import { Html } from "@react-email/html";
import { Img } from "@react-email/img";
import { Section } from "@react-email/section";
import { render } from "@react-email/render";
import { env } from "../../env.mjs";
import { sendEmail } from "./emailSender";

export interface SendBudgetIncreaseRequestEmailInput {
  to: string;
  requesterEmail: string;
  requesterName?: string;
  organizationName: string;
  scope: string;
  scopeId: string;
  limitUsd: string;
  spentUsd: string;
  period?: string;
  message?: string;
}

const labelCellStyle: React.CSSProperties = {
  padding: "8px 12px 8px 0",
  color: "#5f6c7b",
  fontWeight: 500,
  fontSize: "13px",
  whiteSpace: "nowrap",
  verticalAlign: "top",
};

const valueCellStyle: React.CSSProperties = {
  padding: "8px 0",
  color: "#1f2933",
  fontSize: "13px",
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
};

export const sendBudgetIncreaseRequestEmail = async (
  input: SendBudgetIncreaseRequestEmailInput,
): Promise<void> => {
  const dashboardUrl = `${env.BASE_HOST.replace(/\/$/, "")}/settings/governance/budgets`;
  const periodLabel = input.period ?? "current period";
  const subject = `Budget increase requested by ${input.requesterEmail}`;

  const emailHtml = await render(
    <Html lang="en" dir="ltr">
      <Container
        style={{
          border: "1px solid #F2F4F8",
          borderRadius: "10px",
          padding: "24px",
          paddingBottom: "16px",
          fontFamily:
            "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        }}
      >
        <Img
          src="https://app.langwatch.ai/images/logo-icon.png"
          alt="LangWatch Logo"
          width="36"
        />
        <Heading as="h1" style={{ fontSize: "20px", marginTop: "8px" }}>
          Budget increase request
        </Heading>
        <p style={{ fontSize: "14px", lineHeight: 1.6 }}>
          <strong>{input.requesterName ?? input.requesterEmail}</strong>{" "}
          (<a href={`mailto:${input.requesterEmail}`}>{input.requesterEmail}</a>){" "}
          has requested a budget increase in{" "}
          <strong>{input.organizationName}</strong>.
        </p>
        <Section style={{ paddingTop: "8px" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              <tr>
                <td style={labelCellStyle}>Scope</td>
                <td style={valueCellStyle}>{input.scope}</td>
              </tr>
              <tr>
                <td style={labelCellStyle}>Scope ID</td>
                <td style={valueCellStyle}>{input.scopeId}</td>
              </tr>
              <tr>
                <td style={labelCellStyle}>Period</td>
                <td style={valueCellStyle}>{periodLabel}</td>
              </tr>
              <tr>
                <td style={labelCellStyle}>Current limit</td>
                <td style={valueCellStyle}>${input.limitUsd}</td>
              </tr>
              <tr>
                <td style={labelCellStyle}>Spent so far</td>
                <td style={valueCellStyle}>${input.spentUsd}</td>
              </tr>
            </tbody>
          </table>
        </Section>
        {input.message && (
          <Section style={{ paddingTop: "16px" }}>
            <Heading as="h3" style={{ fontSize: "15px" }}>
              Message from the user
            </Heading>
            <p
              style={{
                fontSize: "14px",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
              }}
            >
              {input.message}
            </p>
          </Section>
        )}
        <Section style={{ paddingTop: "16px" }}>
          <Button
            href={dashboardUrl}
            style={{
              padding: "10px 20px",
              color: "white",
              backgroundColor: "#ED8926",
              textDecoration: "none",
              borderRadius: "6px",
            }}
          >
            Approve via LangWatch
          </Button>
        </Section>
        <p
          style={{
            paddingTop: "12px",
            fontSize: "12px",
            color: "#5f6c7b",
          }}
        >
          You're receiving this because you're an organization admin in
          LangWatch. If this is unexpected, you can reply directly to{" "}
          {input.requesterEmail}.
        </p>
      </Container>
    </Html>,
  );

  await sendEmail({ to: input.to, subject, html: emailHtml });
};
