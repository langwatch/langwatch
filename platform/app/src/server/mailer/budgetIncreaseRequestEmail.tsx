import { render } from "@react-email/render";
import { env } from "../../env.mjs";
import {
  EmailAction,
  EmailCallout,
  EmailFacts,
  EmailFinePrint,
  EmailParagraph,
  EmailSectionHeading,
  EmailShell,
  emailLinkStyle,
} from "./emailLayout";
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

export const sendBudgetIncreaseRequestEmail = async (
  input: SendBudgetIncreaseRequestEmailInput,
): Promise<void> => {
  const dashboardUrl = `${env.BASE_HOST.replace(/\/$/, "")}/gateway/budgets`;
  const periodLabel = input.period ?? "current period";
  const subject = `Budget increase requested by ${input.requesterEmail}`;

  const emailHtml = await render(
    <EmailShell
      title="Budget increase request"
      footer={
        <EmailFinePrint>
          You&apos;re receiving this because you&apos;re an organization admin
          in LangWatch. If this is unexpected, you can reply directly to{" "}
          {input.requesterEmail}.
        </EmailFinePrint>
      }
    >
      <EmailParagraph>
        <strong>{input.requesterName ?? input.requesterEmail}</strong> (
        <a href={`mailto:${input.requesterEmail}`} style={emailLinkStyle}>
          {input.requesterEmail}
        </a>
        ) has requested a budget increase in{" "}
        <strong>{input.organizationName}</strong>.
      </EmailParagraph>
      <EmailFacts
        rows={[
          { label: "Scope", value: input.scope, mono: true },
          { label: "Scope ID", value: input.scopeId, mono: true },
          { label: "Period", value: periodLabel, mono: true },
          { label: "Current limit", value: `$${input.limitUsd}`, mono: true },
          { label: "Spent so far", value: `$${input.spentUsd}`, mono: true },
        ]}
      />
      {input.message ? (
        <>
          <EmailSectionHeading>Message from the user</EmailSectionHeading>
          <EmailCallout>
            <EmailParagraph style={{ margin: 0, whiteSpace: "pre-wrap" }}>
              {input.message}
            </EmailParagraph>
          </EmailCallout>
        </>
      ) : null}
      <EmailAction href={dashboardUrl} label="Approve via LangWatch" />
    </EmailShell>,
  );

  await sendEmail({ to: input.to, subject, html: emailHtml });
};
