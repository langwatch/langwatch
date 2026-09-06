import { Section, Text } from "@react-email/components";
import { z } from "zod";
import { sendEmail } from "../email-sender";
import type { EmailDeliveryPort } from "../providers/types";
import { EmailLayout, Muted, Paragraph, PrimaryButton, expressive } from "./email-layout";
import { defineTemplate, renderMailTemplate } from "./registry";

export const usageLimitEmailProps = z.object({
  organizationName: z.string().min(1),
  usagePercentage: z.number().nonnegative(),
  usagePercentageFormatted: z.string().min(1),
  currentMonthMessagesCount: z.number().int().nonnegative(),
  maxMonthlyUsageLimit: z.number().int().positive(),
  crossedThreshold: z.number().nonnegative().describe("The threshold that triggered this send"),
  projectUsageData: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      messageCount: z.number().int().nonnegative(),
    }),
  ),
  actionUrl: z.url(),
  severity: z.string().min(1).optional().describe("How the sender graded this crossing"),
});

export type UsageLimitEmailProps = z.infer<typeof usageLimitEmailProps>;

export const usageLimitEmailSubject = ({
  severity,
  usagePercentageFormatted,
}: UsageLimitEmailProps): string =>
  severity
    ? `Usage ${severity}: ${usagePercentageFormatted}% of your monthly message limit`
    : `You have used ${usagePercentageFormatted}% of your monthly message limit`;

/**
 * How far along the bar reads.
 *
 * Green while there is room, amber once the end is in sight, red at the point
 * where messages start being dropped. Three stops rather than five: the two
 * extra cuts the old ladder had resolved to the same colour anyway.
 */
const barColour = (usagePercentage: number): string => {
  if (usagePercentage >= 95) return "#c53030";
  if (usagePercentage >= 70) return expressive.light.detail;
  return "#2f7a55";
};

/**
 * A meter built from nested table cells.
 *
 * No flexbox, no `div` with a percentage width: Outlook's engine renders
 * neither, and a progress bar that collapses to nothing is worse than no bar.
 * Two cells in one row, sized in percent, is the shape every client draws.
 */
const UsageBar = ({ usagePercentage, filled }: { usagePercentage: number; filled: number }) => (
  <table
    style={{
      width: "100%",
      borderCollapse: "collapse",
      tableLayout: "fixed",
      height: "8px",
      margin: "10px 0 0",
    }}
  >
    <tbody>
      <tr>
        <td
          style={{
            width: `${filled}%`,
            backgroundColor: barColour(usagePercentage),
            borderRadius: "4px 0 0 4px",
            fontSize: 0,
            lineHeight: "8px",
          }}
        >
          &nbsp;
        </td>
        <td
          className="lw-code"
          style={{
            width: `${100 - filled}%`,
            backgroundColor: expressive.light.field,
            borderRadius: "0 4px 4px 0",
            fontSize: 0,
            lineHeight: "8px",
          }}
        >
          &nbsp;
        </td>
      </tr>
    </tbody>
  </table>
);

const cell = {
  padding: "10px 0",
  fontSize: "13.5px",
  color: expressive.light.text,
} as const;

export const UsageLimitEmail = ({
  organizationName,
  usagePercentage,
  usagePercentageFormatted,
  currentMonthMessagesCount,
  maxMonthlyUsageLimit,
  crossedThreshold,
  projectUsageData,
  actionUrl,
}: UsageLimitEmailProps) => (
  <EmailLayout
    eyebrow="USAGE"
    preview={`${usagePercentageFormatted}% of the monthly message limit used`}
    heading={`You have used ${usagePercentageFormatted}% of your monthly message limit`}
    footNote={`You are receiving this because you administer ${organizationName}.`}
  >
    <Paragraph>
      <strong>{organizationName}</strong> has used {usagePercentageFormatted}% of its monthly
      message limit.{" "}
      {crossedThreshold >= 100
        ? "To carry on using LangWatch, move to a larger plan."
        : "New traces will start being dropped soon, and evaluations and simulations will be blocked. A larger plan raises the limit."}
    </Paragraph>

    <Section style={{ margin: "24px 0" }}>
      <Text style={{ ...cell, margin: 0, fontWeight: 600 }}>
        {currentMonthMessagesCount.toLocaleString()} of {maxMonthlyUsageLimit.toLocaleString()}{" "}
        messages
      </Text>
      <UsageBar usagePercentage={usagePercentage} filled={Math.min(usagePercentage, 100)} />
    </Section>

    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th
            className="lw-muted"
            style={{
              padding: "0 0 8px",
              textAlign: "left",
              fontSize: "12.5px",
              fontWeight: 500,
              color: expressive.light.textMuted,
              borderBottom: `1px solid ${expressive.light.hairline}`,
            }}
          >
            Project
          </th>
          <th
            className="lw-muted"
            style={{
              padding: "0 0 8px",
              textAlign: "right",
              fontSize: "12.5px",
              fontWeight: 500,
              color: expressive.light.textMuted,
              borderBottom: `1px solid ${expressive.light.hairline}`,
            }}
          >
            Messages
          </th>
        </tr>
      </thead>
      <tbody>
        {projectUsageData.map((project) => (
          <tr key={project.id}>
            <td
              className="lw-text"
              style={{ ...cell, borderBottom: `1px solid ${expressive.light.hairline}` }}
            >
              {project.name}
            </td>
            <td
              className="lw-text"
              style={{
                ...cell,
                textAlign: "right",
                borderBottom: `1px solid ${expressive.light.hairline}`,
              }}
            >
              {project.messageCount.toLocaleString()}
            </td>
          </tr>
        ))}
        <tr>
          <td className="lw-text" style={{ ...cell, fontWeight: 600 }}>
            Total across {projectUsageData.length.toLocaleString()} projects
          </td>
          <td className="lw-text" style={{ ...cell, textAlign: "right", fontWeight: 600 }}>
            {currentMonthMessagesCount.toLocaleString()}
          </td>
        </tr>
      </tbody>
    </table>

    <PrimaryButton href={actionUrl}>View usage details</PrimaryButton>
    <Muted>You can move to a larger plan from the same page.</Muted>
  </EmailLayout>
);

export const usageLimitEmailTemplate = defineTemplate({
  id: "usage-limit",
  title: "Monthly message limit",
  sentWhen: "An organization crosses a share of its monthly message limit. Sent to the admins.",
  schema: usageLimitEmailProps,
  subject: usageLimitEmailSubject,
  Component: UsageLimitEmail,
  fixtures: {
    "approaching the limit": {
      organizationName: "Acme Corp",
      usagePercentage: 78.4,
      usagePercentageFormatted: "78.4",
      currentMonthMessagesCount: 784_120,
      maxMonthlyUsageLimit: 1_000_000,
      crossedThreshold: 70,
      projectUsageData: [
        { id: "project_KAXYxPR8MU", name: "Support agent", messageCount: 512_403 },
        { id: "project_9mQvT7hLzR", name: "Sales copilot", messageCount: 214_688 },
        { id: "project_3bR1eeXc04", name: "Internal tools", messageCount: 57_029 },
      ],
      actionUrl: "https://app.langwatch.ai/settings/usage",
      severity: "warning",
    },
    "limit reached": {
      organizationName: "Acme Corp",
      usagePercentage: 100,
      usagePercentageFormatted: "100.0",
      currentMonthMessagesCount: 1_000_000,
      maxMonthlyUsageLimit: 1_000_000,
      crossedThreshold: 100,
      projectUsageData: [
        { id: "project_KAXYxPR8MU", name: "Support agent", messageCount: 1_000_000 },
      ],
      actionUrl: "https://app.langwatch.ai/settings/usage",
      severity: "critical",
    },
  },
});

export const sendUsageLimitEmail = async ({
  mailer,
  to,
  ...props
}: UsageLimitEmailProps & { to: string; mailer: EmailDeliveryPort }) => {
  const { subject, html } = await renderMailTemplate(usageLimitEmailTemplate, props);
  await sendEmail({ mailer, content: { to, subject, html } });
};
