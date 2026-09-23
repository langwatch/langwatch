import { z } from "zod";

import { sendEmail } from "../email-sender.ts";
import type { EmailDelivery } from "../providers/types.ts";
import { DetailTable, EmailLayout, Muted, Paragraph } from "./email-layout.tsx";
import { defineTemplate, renderMailTemplate } from "./registry.ts";

const CENTS_PER_USD = 100;

export const connectedStatementEmailProps = z.object({
  organizationName: z.string().min(1),
  monthLabel: z.string().min(1).describe("The month covered, as the reader says it: August 2026"),
  spendByService: z.array(
    z.object({
      service: z.string().min(1).describe("The service as the license names it"),
      usdCents: z.number().int().nonnegative(),
    }),
  ),
  totalUsdCents: z.number().int().nonnegative(),
  commitUsdCents: z.number().int().nonnegative(),
  commitDrawnDownUsdCents: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .describe("Null when the spend ledger could not be read"),
  creditRemainingUsdCents: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .describe("Null when the drawdown could not be read"),
  seatsLicensed: z.number().int().nonnegative(),
  seatsReported: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .describe("Null when the install has never reported its seats"),
});

export type ConnectedStatementEmailProps = z.infer<typeof connectedStatementEmailProps>;

/** The services as a customer reads them, rather than as the license names them. */
const SERVICE_LABELS: Readonly<Record<string, string>> = {
  instant_evals: "Instant Evals",
  managed_models: "Managed models",
};

const serviceLabel = (service: string): string => SERVICE_LABELS[service] ?? service;

const usd = (cents: number): string => `${(cents / CENTS_PER_USD).toFixed(2)} USD`;

const amountOrUnavailable = (cents: number | null): string =>
  cents === null ? "unavailable" : usd(cents);

export const connectedStatementEmailSubject = ({
  monthLabel,
}: ConnectedStatementEmailProps): string => `LangWatch hosted services for ${monthLabel}`;

/**
 * A statement, not an invoice: a connected customer is invoiced quarterly, and
 * this tells them where the prepaid commit stands between those invoices.
 */
export const ConnectedStatementEmail = ({
  organizationName,
  monthLabel,
  spendByService,
  totalUsdCents,
  commitUsdCents,
  commitDrawnDownUsdCents,
  creditRemainingUsdCents,
  seatsLicensed,
  seatsReported,
}: ConnectedStatementEmailProps) => (
  <EmailLayout
    eyebrow="STATEMENT"
    preview={`What hosted services cost ${organizationName} in ${monthLabel}`}
    heading={`LangWatch hosted services for ${monthLabel}`}
    footNote="You receive this because you are the billing contact for a LangWatch license."
  >
    <Paragraph>
      {`This is the statement for ${organizationName}. Hosted services are invoiced every three months, so nothing here is due now.`}
    </Paragraph>
    <DetailTable
      rows={[
        ...spendByService.map((line) => ({
          label: serviceLabel(line.service),
          value: usd(line.usdCents),
        })),
        { label: "Total for the month", value: usd(totalUsdCents) },
      ]}
    />
    <DetailTable
      rows={[
        { label: "Prepaid commit for the term", value: usd(commitUsdCents) },
        { label: "Drawn down so far", value: amountOrUnavailable(commitDrawnDownUsdCents) },
        { label: "Credit remaining", value: amountOrUnavailable(creditRemainingUsdCents) },
        { label: "Seats licensed", value: seatsLicensed.toLocaleString() },
        {
          label: "Seats reported",
          value: seatsReported === null ? "not reported yet" : seatsReported.toLocaleString(),
        },
      ]}
    />
    <Muted>
      Questions about a line on this statement? Reply to this message and we will explain it.
    </Muted>
  </EmailLayout>
);

export const connectedStatementEmailTemplate = defineTemplate({
  id: "connected-statement",
  title: "Monthly hosted services statement",
  sentWhen:
    "Once a month, to the billing contact of a connected self-hosted customer whose hosted services cost something that month.",
  schema: connectedStatementEmailProps,
  subject: connectedStatementEmailSubject,
  Component: ConnectedStatementEmail,
  fixtures: {
    default: {
      organizationName: "Acme Corp",
      monthLabel: "August 2026",
      spendByService: [{ service: "instant_evals", usdCents: 184_32 }],
      totalUsdCents: 184_32,
      commitUsdCents: 5_000_00,
      commitDrawnDownUsdCents: 1_212_40,
      creditRemainingUsdCents: 3_787_60,
      seatsLicensed: 50,
      seatsReported: 43,
    },
    "the spend ledger could not be read": {
      organizationName: "Northwind Logistics",
      monthLabel: "September 2026",
      spendByService: [{ service: "instant_evals", usdCents: 12_05 }],
      totalUsdCents: 12_05,
      commitUsdCents: 1_000_00,
      commitDrawnDownUsdCents: null,
      creditRemainingUsdCents: null,
      seatsLicensed: 10,
      seatsReported: null,
    },
  },
});

/** Sends one month's statement to the billing contact. */
export const sendConnectedStatementEmail = async ({
  mailer,
  to,
  ...props
}: ConnectedStatementEmailProps & { mailer: EmailDelivery; to: string }): Promise<void> => {
  const { subject, html } = await renderMailTemplate(connectedStatementEmailTemplate, props);
  await sendEmail({ mailer, content: { to, subject, html } });
};
