/**
 * The monthly usage statement a connected self-hosted customer's billing
 * contact receives (ADR-141, section 7).
 *
 * It is a statement, not an invoice: a connected customer is invoiced
 * quarterly, and this is what tells them where the prepaid commit stands
 * between those invoices.
 */

import {
  Container,
  Heading,
  Html,
  Section,
  Text,
} from "@react-email/components";
import { render } from "@react-email/render";
import { sendEmail } from "./emailSender";

const CENTS_PER_USD = 100;

/** One hosted service's spend for the month. */
export interface StatementServiceLine {
  service: string;
  usdCents: number;
}

export interface ConnectedStatementEmailProps {
  organizationName: string;
  monthLabel: string;
  spendByService: StatementServiceLine[];
  totalUsdCents: number;
  commitUsdCents: number;
  /** Null when the spend ledger could not be read. */
  commitDrawnDownUsdCents: number | null;
  /** Null when the drawdown could not be read. */
  creditRemainingUsdCents: number | null;
  seatsLicensed: number;
  /** Null when the install has never reported its seats. */
  seatsReported: number | null;
}

/** The services as a customer reads them, rather than as the license names them. */
const SERVICE_LABELS: Record<string, string> = {
  instant_evals: "Instant Evals",
  managed_models: "Managed models",
};

function serviceLabel(service: string): string {
  return SERVICE_LABELS[service] ?? service;
}

function usd(cents: number): string {
  return `${(cents / CENTS_PER_USD).toFixed(2)} USD`;
}

function amountOrUnavailable(cents: number | null): string {
  return cents === null ? "unavailable" : usd(cents);
}

const cellStyle = {
  padding: "12px 16px",
  fontSize: "14px",
  color: "#1f2937",
} as const;

const rightCellStyle = { ...cellStyle, textAlign: "right" } as const;

const ConnectedStatementEmailTemplate = ({
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
  <Html lang="en" dir="ltr">
    <Container
      style={{
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        maxWidth: "600px",
        margin: "0 auto",
        backgroundColor: "#ffffff",
        padding: "40px 20px",
      }}
    >
      <Heading
        as="h1"
        style={{
          fontSize: "22px",
          fontWeight: 600,
          color: "#1f2937",
          margin: "0 0 16px 0",
        }}
      >
        LangWatch hosted services for {monthLabel}
      </Heading>
      <Text
        style={{
          fontSize: "16px",
          color: "#4b5563",
          lineHeight: 1.5,
          margin: "0 0 24px 0",
        }}
      >
        This is the statement for {organizationName}. Hosted services are
        invoiced every three months, so nothing here is due now.
      </Text>

      <Section
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: "8px",
          marginBottom: "24px",
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {spendByService.map((line) => (
              <tr
                key={line.service}
                style={{ borderBottom: "1px solid #e5e7eb" }}
              >
                <td style={cellStyle}>{serviceLabel(line.service)}</td>
                <td style={rightCellStyle}>{usd(line.usdCents)}</td>
              </tr>
            ))}
            <tr style={{ backgroundColor: "#f9fafb" }}>
              <td style={{ ...cellStyle, fontWeight: 600 }}>
                Total for the month
              </td>
              <td style={{ ...rightCellStyle, fontWeight: 600 }}>
                {usd(totalUsdCents)}
              </td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: "8px",
          marginBottom: "24px",
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
              <td style={cellStyle}>Prepaid commit for the term</td>
              <td style={rightCellStyle}>{usd(commitUsdCents)}</td>
            </tr>
            <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
              <td style={cellStyle}>Drawn down so far</td>
              <td style={rightCellStyle}>
                {amountOrUnavailable(commitDrawnDownUsdCents)}
              </td>
            </tr>
            <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
              <td style={cellStyle}>Credit remaining</td>
              <td style={rightCellStyle}>
                {amountOrUnavailable(creditRemainingUsdCents)}
              </td>
            </tr>
            <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
              <td style={cellStyle}>Seats licensed</td>
              <td style={rightCellStyle}>{seatsLicensed}</td>
            </tr>
            <tr>
              <td style={cellStyle}>Seats reported</td>
              <td style={rightCellStyle}>
                {seatsReported === null ? "not reported yet" : seatsReported}
              </td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Text style={{ fontSize: "14px", color: "#6b7280", lineHeight: 1.6 }}>
        Questions about a line on this statement? Reply to this message and we
        will explain it.
      </Text>
    </Container>
  </Html>
);

export const sendConnectedStatementEmail = async ({
  to,
  ...props
}: ConnectedStatementEmailProps & { to: string }): Promise<void> => {
  const html = await render(<ConnectedStatementEmailTemplate {...props} />);

  await sendEmail({
    to,
    subject: `LangWatch hosted services for ${props.monthLabel}`,
    html,
  });
};
