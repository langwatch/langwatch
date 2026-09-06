import { z } from "zod";
import { sendEmail } from "../email-sender";
import type { EmailDeliveryPort } from "../providers/types";
import {
  DetailTable,
  EmailLayout,
  InlineLink,
  Paragraph,
  PrimaryButton,
  TintPanel,
  TintText,
} from "./email-layout";
import { defineTemplate, renderMailTemplate } from "./registry";

export const budgetIncreaseRequestEmailProps = z.object({
  requesterEmail: z.email(),
  requesterName: z.string().min(1).optional(),
  organizationName: z.string().min(1),
  /**
   * Where the recipient goes to act on it.
   *
   * The deployment's public base URL is the deployment's, so it arrives with
   * the message rather than being read out of this package's environment.
   */
  budgetsUrl: z.url(),
  scope: z.string().min(1),
  scopeId: z.string().min(1),
  limitUsd: z.string().min(1),
  spentUsd: z.string().min(1),
  period: z.string().min(1).optional(),
  message: z.string().optional().describe("What the requester wrote, in their own words"),
});

export type BudgetIncreaseRequestEmailProps = z.infer<typeof budgetIncreaseRequestEmailProps>;

export type SendBudgetIncreaseRequestEmailInput = BudgetIncreaseRequestEmailProps & {
  to: string;
};

export const budgetIncreaseRequestEmailSubject = ({
  requesterEmail,
}: BudgetIncreaseRequestEmailProps): string => `Budget increase requested by ${requesterEmail}`;

export const BudgetIncreaseRequestEmail = (props: BudgetIncreaseRequestEmailProps) => (
  <EmailLayout
    preview={`${props.requesterName ?? props.requesterEmail} needs a higher budget`}
    heading="Budget increase request"
    footNote={`You are receiving this because you administer ${props.organizationName}. You can reply straight to ${props.requesterEmail}.`}
  >
    <Paragraph>
      <strong>{props.requesterName ?? props.requesterEmail}</strong> (
      <InlineLink href={`mailto:${props.requesterEmail}`}>{props.requesterEmail}</InlineLink>) has
      requested a budget increase in <strong>{props.organizationName}</strong>.
    </Paragraph>
    <DetailTable
      rows={[
        { label: "Scope", value: props.scope },
        { label: "Scope ID", value: props.scopeId },
        { label: "Period", value: props.period ?? "current period" },
        { label: "Current limit", value: `$${props.limitUsd}` },
        { label: "Spent so far", value: `$${props.spentUsd}` },
      ]}
    />
    {props.message && (
      <TintPanel>
        <TintText>
          <strong>{`Message from ${props.requesterName ?? props.requesterEmail}`}</strong>
        </TintText>
        <TintText>{props.message}</TintText>
      </TintPanel>
    )}
    <PrimaryButton href={props.budgetsUrl}>Review the budget</PrimaryButton>
  </EmailLayout>
);

export const budgetIncreaseRequestEmailTemplate = defineTemplate({
  id: "budget-increase-request",
  title: "Budget increase request",
  sentWhen: "Somebody asks for a higher spend limit. Sent to the organization admins.",
  schema: budgetIncreaseRequestEmailProps,
  subject: budgetIncreaseRequestEmailSubject,
  Component: BudgetIncreaseRequestEmail,
  fixtures: {
    default: {
      requesterEmail: "morgan@acme.example",
      requesterName: "Morgan Ellis",
      organizationName: "Acme Corp",
      budgetsUrl: "https://app.langwatch.ai/settings/budgets",
      scope: "project",
      scopeId: "project_KAXYxPR8MUgTcP8CF193y",
      limitUsd: "250.00",
      spentUsd: "248.60",
      period: "September 2026",
      message:
        "We are running the new support agent evaluation this week and it needs roughly double the usual headroom until Friday.",
    },
    "no note, no period": {
      requesterEmail: "sam@acme.example",
      organizationName: "Acme Corp",
      budgetsUrl: "https://app.langwatch.ai/settings/budgets",
      scope: "organization",
      scopeId: "organization_2mQvT7hLzR",
      limitUsd: "1000.00",
      spentUsd: "1000.00",
    },
  },
});

export const sendBudgetIncreaseRequestEmail = async ({
  mailer,
  to,
  ...props
}: SendBudgetIncreaseRequestEmailInput & { mailer: EmailDeliveryPort }): Promise<void> => {
  const { subject, html } = await renderMailTemplate(budgetIncreaseRequestEmailTemplate, props);
  await sendEmail({ mailer, content: { to, subject, html } });
};
