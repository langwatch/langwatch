import { z } from "zod";

import { sendEmail } from "../email-sender.ts";
import type { MailSender } from "../email-sender.ts";
import {
  ActionRow,
  DetailTable,
  EmailLayout,
  Muted,
  Paragraph,
  TintPanel,
  TintText,
} from "./email-layout.tsx";
import { defineTemplate, renderMailTemplate } from "./registry.ts";

/**
 * The failed payment recovery mail (enterprise/modules/billing/specs/payment-recovery.feature):
 * day 0, the day 3 and 7 reminders, the day 14 warning, the day 21 pause and the restore.
 */
export const paymentRecoveryEmailKinds = [
  "failed",
  "reminder",
  "final",
  "paused",
  "restored",
] as const;

export const paymentRecoveryEmailProps = z.object({
  kind: z.enum(paymentRecoveryEmailKinds),
  organizationName: z.string().min(1),
  planName: z.string().min(1),
  /** The invoice total including VAT, already formatted in its currency. */
  amount: z.string().min(1),
  invoiceNumber: z.string().min(1).optional(),
  /** When the invoice was issued, as a reader's date. */
  invoiceDate: z.string().min(1),
  /** The date access stops: day 0 plus 21 days. */
  accessStopsOn: z.string().min(1),
  card: z.object({ brand: z.string().min(1), last4: z.string().min(1) }).optional(),
  /** What Free allows, for the day 14 warning. */
  freeLimits: z
    .object({ eventsPerMonth: z.number().int().positive(), eachOfScenarios: z.number().int() })
    .optional(),
  actionUrl: z.url(),
});

export type PaymentRecoveryEmailProps = z.infer<typeof paymentRecoveryEmailProps>;

export const paymentRecoveryEmailSubject = ({
  kind,
  planName,
  accessStopsOn,
}: PaymentRecoveryEmailProps): string => {
  switch (kind) {
    case "failed":
      return "Your LangWatch payment failed";
    case "reminder":
      return "Reminder: your LangWatch payment is still due";
    case "final":
      return `Your LangWatch plan pauses on ${accessStopsOn}`;
    case "paused":
      return "Your plan is paused";
    case "restored":
      return `Thanks, you're back on ${planName}`;
  }
};

const headingOf = ({ kind, organizationName, planName }: PaymentRecoveryEmailProps): string => {
  switch (kind) {
    case "failed":
      return "Your payment didn't go through";
    case "reminder":
      return "Your payment is still due";
    case "final":
      return `One week left to keep your ${planName} plan`;
    case "paused":
      return `${organizationName} is paused for non-payment`;
    case "restored":
      return "Thanks, you're back";
  }
};

const invoiceRows = (props: PaymentRecoveryEmailProps) =>
  props.invoiceNumber ? [{ label: "Invoice", value: props.invoiceNumber }] : [];

const Body = (props: PaymentRecoveryEmailProps) => {
  const { kind, organizationName, planName, amount, invoiceDate, accessStopsOn, card } = props;
  switch (kind) {
    case "failed":
      return (
        <>
          <Paragraph>
            {card
              ? `We couldn't charge ${amount} to the ${card.brand} ending ${card.last4} for ${organizationName}'s ${planName} plan.`
              : `We couldn't charge ${amount} for ${organizationName}'s ${planName} plan.`}
          </Paragraph>
          <Paragraph>Update your card and we'll charge it again right away.</Paragraph>
          <DetailTable
            rows={[
              ...invoiceRows(props),
              { label: "Amount", value: `${amount} incl. VAT` },
              { label: "Date", value: invoiceDate },
            ]}
          />
        </>
      );
    case "reminder":
      return (
        <>
          <Paragraph>{`${organizationName}'s invoice of ${amount} from ${invoiceDate} is unpaid.`}</Paragraph>
          <Paragraph>{`To keep your ${planName} plan, update your card before ${accessStopsOn}.`}</Paragraph>
          <TintPanel>
            <TintText>{`Access stops on ${accessStopsOn}`}</TintText>
          </TintPanel>
        </>
      );
    case "final":
      return (
        <>
          <Paragraph>{`The invoice of ${amount} is still unpaid. On ${accessStopsOn}, ${organizationName} moves to Free plan limits.`}</Paragraph>
          <Paragraph>Your data stays safe. Nothing is deleted.</Paragraph>
          {props.freeLimits && (
            <>
              <Muted>Free plan limits</Muted>
              <DetailTable
                rows={[
                  {
                    label: "Events",
                    value: `${props.freeLimits.eventsPerMonth.toLocaleString("en-GB")} a month`,
                  },
                  {
                    label: "Scenarios, simulations, custom evals",
                    value: `${props.freeLimits.eachOfScenarios} each`,
                  },
                ]}
              />
            </>
          )}
        </>
      );
    case "paused":
      return (
        <>
          <Paragraph>{`The invoice from ${invoiceDate} is still unpaid, so Free plan limits apply. Nothing is deleted.`}</Paragraph>
          <Paragraph>Pay it and everything comes back right away.</Paragraph>
          <DetailTable
            rows={[
              ...invoiceRows(props),
              { label: "Amount", value: amount },
              { label: "Due since", value: invoiceDate },
            ]}
          />
        </>
      );
    case "restored":
      return (
        <>
          <Paragraph>{`We received ${amount} for ${organizationName}.`}</Paragraph>
          <Paragraph>{`Your ${planName} plan and its limits are back, starting now.`}</Paragraph>
          <DetailTable rows={[...invoiceRows(props), { label: "Status", value: "Paid" }]} />
        </>
      );
  }
};

const ACTION_LABEL: Record<PaymentRecoveryEmailProps["kind"], string> = {
  failed: "Update card",
  reminder: "Update card",
  final: "Pay now",
  paused: "Pay now",
  restored: "Open LangWatch",
};

const NOTE: Partial<Record<PaymentRecoveryEmailProps["kind"], string>> = {
  failed: "Nothing changes for your team yet.",
  reminder: "Already paid? Then you can ignore this email.",
  final: "Pay any time and everything comes back at once.",
  restored: "Your receipt is with your invoices.",
};

export const PaymentRecoveryEmail = (props: PaymentRecoveryEmailProps) => {
  const note = NOTE[props.kind];
  return (
    <EmailLayout
      preview={paymentRecoveryEmailSubject(props)}
      heading={headingOf(props)}
      footNote={`You are receiving this because you manage billing for ${props.organizationName}.`}
    >
      <Body {...props} />
      <ActionRow primary={{ href: props.actionUrl, label: ACTION_LABEL[props.kind] }} />
      {note && <Muted>{note}</Muted>}
    </EmailLayout>
  );
};

const FIXTURE_BASE = {
  organizationName: "ACME",
  planName: "Growth",
  amount: "€280.72",
  invoiceNumber: "ACME-0008",
  invoiceDate: "1 November 2026",
  accessStopsOn: "22 November 2026",
} as const;

export const paymentRecoveryEmailTemplate = defineTemplate({
  id: "payment-recovery",
  title: "Failed payment recovery",
  sentWhen:
    "A renewal charge fails, on days 3, 7, 14 and 21 while it stays unpaid, and when it is paid. Sent to admins and Billing members.",
  schema: paymentRecoveryEmailProps,
  subject: paymentRecoveryEmailSubject,
  Component: PaymentRecoveryEmail,
  fixtures: {
    "payment failed": {
      ...FIXTURE_BASE,
      kind: "failed",
      card: { brand: "Visa", last4: "4417" },
      actionUrl: "https://app.langwatch.ai/settings/subscription?updateCard=1",
    },
    reminder: {
      ...FIXTURE_BASE,
      kind: "reminder",
      actionUrl: "https://app.langwatch.ai/settings/subscription?updateCard=1",
    },
    "final warning": {
      ...FIXTURE_BASE,
      kind: "final",
      freeLimits: { eventsPerMonth: 50_000, eachOfScenarios: 3 },
      actionUrl: "https://app.langwatch.ai/settings/subscription?pay=1",
    },
    paused: {
      ...FIXTURE_BASE,
      kind: "paused",
      actionUrl: "https://app.langwatch.ai/settings/subscription?pay=1",
    },
    restored: {
      ...FIXTURE_BASE,
      kind: "restored",
      actionUrl: "https://app.langwatch.ai",
    },
  },
});

export const sendPaymentRecoveryEmail = async ({
  mailer,
  to,
  ...props
}: PaymentRecoveryEmailProps & { to: string; mailer: MailSender }) => {
  const { subject, html } = await renderMailTemplate(paymentRecoveryEmailTemplate, props);
  await sendEmail({ mailer, content: { to, subject, html } });
};
