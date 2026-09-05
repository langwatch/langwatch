import { Section } from "@react-email/components";
import { render } from "@react-email/render";
import {
  EmailAction,
  EmailCallout,
  EmailFinePrint,
  EmailParagraph,
  EmailShell,
  emailLinkStyle,
} from "./emailLayout";
import { sendEmail } from "./emailSender";
import {
  EMAIL_COLOR,
  EMAIL_FONT,
  EMAIL_RADIUS,
  EMAIL_SPACE,
  EMAIL_TYPE,
} from "./emailTheme";

interface ProjectUsageData {
  id: string;
  name: string;
  messageCount: number;
}

interface UsageLimitEmailProps {
  organizationName: string;
  usagePercentage: number;
  usagePercentageFormatted: string;
  currentMonthMessagesCount: number;
  maxMonthlyUsageLimit: number;
  crossedThreshold: number;
  projectUsageData: ProjectUsageData[];
  actionUrl: string;
  logoUrl: string;
}

/**
 * How close to the limit, said in colour.
 *
 * Two values per band rather than one: a bar is a shape and can carry the
 * brand orange straight, while the number beside it is text on white and has
 * to clear contrast. The orange that reads as a filled bar is the same orange
 * one step deeper once it is set as type — `auth.detail` and
 * `auth.ink`, exactly as the auth screens pairs them.
 */
const usageBand = (usagePercentage: number) => {
  if (usagePercentage >= 95) {
    return { bar: EMAIL_COLOR.danger, text: EMAIL_COLOR.danger };
  }
  if (usagePercentage >= 70) {
    return { bar: EMAIL_COLOR.detail, text: EMAIL_COLOR.accentText };
  }
  return { bar: EMAIL_COLOR.ok, text: EMAIL_COLOR.ok };
};

const headCellStyle = {
  padding: "10px 16px",
  fontSize: EMAIL_TYPE.label.size,
  fontWeight: EMAIL_TYPE.label.weight,
  lineHeight: EMAIL_TYPE.label.leading,
  color: EMAIL_COLOR.textMuted,
  backgroundColor: EMAIL_COLOR.fieldBg,
  borderBottom: `1px solid ${EMAIL_COLOR.hairline}`,
} as const;

const cellStyle = {
  padding: "11px 16px",
  fontSize: EMAIL_TYPE.small.size,
  lineHeight: EMAIL_TYPE.small.leading,
  color: EMAIL_COLOR.text,
} as const;

const meterLabelStyle = {
  margin: 0,
  fontSize: EMAIL_TYPE.label.size,
  fontWeight: EMAIL_TYPE.label.weight,
  lineHeight: EMAIL_TYPE.label.leading,
  color: EMAIL_COLOR.textMuted,
} as const;

/** Where every message this month came from, and what they add up to. */
const ProjectTable = ({
  projectUsageData,
  currentMonthMessagesCount,
  actionUrl,
}: Pick<
  UsageLimitEmailProps,
  "projectUsageData" | "currentMonthMessagesCount" | "actionUrl"
>) => (
  <Section
    style={{
      border: `1px solid ${EMAIL_COLOR.hairline}`,
      borderRadius: EMAIL_RADIUS.field,
      overflow: "hidden",
      marginBottom: EMAIL_SPACE.row,
    }}
  >
    <table
      style={{ width: "100%", borderCollapse: "collapse" }}
      cellPadding={0}
      cellSpacing={0}
    >
      <thead>
        <tr>
          <th style={{ ...headCellStyle, textAlign: "left" }}>Project</th>
          <th style={{ ...headCellStyle, textAlign: "right" }}>Messages</th>
        </tr>
      </thead>
      <tbody>
        {projectUsageData.map((project) => (
          <tr
            key={project.id}
            style={{ borderBottom: `1px solid ${EMAIL_COLOR.hairline}` }}
          >
            <td style={{ ...cellStyle, textAlign: "left" }}>
              <a href={actionUrl} style={emailLinkStyle}>
                {project.name}
              </a>
            </td>
            <td
              style={{
                ...cellStyle,
                textAlign: "right",
                fontFamily: EMAIL_FONT.mono,
              }}
            >
              {project.messageCount.toLocaleString()}
            </td>
          </tr>
        ))}
        <tr style={{ backgroundColor: EMAIL_COLOR.fieldBg }}>
          <td
            style={{ ...cellStyle, textAlign: "left", fontWeight: 600 }}
          >{`Total (${projectUsageData.length})`}</td>
          <td
            style={{
              ...cellStyle,
              textAlign: "right",
              fontWeight: 600,
              fontFamily: EMAIL_FONT.mono,
            }}
          >
            {currentMonthMessagesCount.toLocaleString()}
          </td>
        </tr>
      </tbody>
    </table>
  </Section>
);

/** One row of the meter: a label on the left, its figure on the right. */
const MeterRow = ({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor: string;
}) => (
  <table
    style={{ width: "100%", borderCollapse: "collapse" }}
    cellPadding={0}
    cellSpacing={0}
  >
    <tbody>
      <tr>
        <td style={{ ...meterLabelStyle, textAlign: "left" }}>{label}</td>
        <td
          style={{
            ...meterLabelStyle,
            textAlign: "right",
            fontWeight: 600,
            color: valueColor,
            fontFamily: EMAIL_FONT.mono,
          }}
        >
          {value}
        </td>
      </tr>
    </tbody>
  </table>
);

/**
 * How much of the month is gone, on the warm tint.
 *
 * The bar is two table cells rather than a filled div, which is the only
 * shape every client agrees on: the first cell is the fill and carries the
 * width, the second is whatever is left.
 */
const UsageMeter = ({
  usagePercentage,
  usagePercentageFormatted,
  currentMonthMessagesCount,
  maxMonthlyUsageLimit,
}: Pick<
  UsageLimitEmailProps,
  | "usagePercentage"
  | "usagePercentageFormatted"
  | "currentMonthMessagesCount"
  | "maxMonthlyUsageLimit"
>) => {
  const band = usageBand(usagePercentage);

  return (
    <EmailCallout>
      <MeterRow
        label="Messages"
        value={`${currentMonthMessagesCount.toLocaleString()} / ${maxMonthlyUsageLimit.toLocaleString()}`}
        valueColor={band.text}
      />
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          backgroundColor: EMAIL_COLOR.ground,
          borderRadius: "4px",
          margin: "8px 0 12px 0",
        }}
        cellPadding={0}
        cellSpacing={0}
      >
        <tbody>
          <tr>
            <td
              style={{
                width: `${Math.min(usagePercentage, 100)}%`,
                height: "8px",
                backgroundColor: band.bar,
                borderRadius: "4px",
                fontSize: 0,
                lineHeight: 0,
              }}
            >
              &nbsp;
            </td>
            <td style={{ fontSize: 0, lineHeight: 0 }}>&nbsp;</td>
          </tr>
        </tbody>
      </table>
      <Section
        style={{
          borderTop: `1px solid ${EMAIL_COLOR.hairline}`,
          paddingTop: "12px",
        }}
      >
        <MeterRow
          label="Usage Percentage"
          value={`${usagePercentageFormatted}%`}
          valueColor={band.text}
        />
      </Section>
    </EmailCallout>
  );
};

const UsageLimitEmailTemplate = ({
  organizationName,
  usagePercentage,
  usagePercentageFormatted,
  currentMonthMessagesCount,
  maxMonthlyUsageLimit,
  crossedThreshold,
  projectUsageData,
  actionUrl,
  logoUrl,
}: UsageLimitEmailProps) => (
  <EmailShell
    logoUrl={logoUrl}
    title={`You've consumed ${usagePercentageFormatted}% of your monthly message limit`}
    footer={
      <EmailFinePrint>
        Questions? Visit the{" "}
        <a href="https://docs.langwatch.ai" style={emailLinkStyle}>
          Help Center
        </a>{" "}
        for more information or feel free to reach out to us. Our support
        engineers are here to help.
      </EmailFinePrint>
    }
  >
    <EmailParagraph>
      Your organization, <strong>{organizationName}</strong>, has consumed{" "}
      {usagePercentageFormatted}% of its monthly message limit.{" "}
      {crossedThreshold >= 100
        ? "To continue using LangWatch, please upgrade your plan."
        : "New traces are going to get dropped soon, evaluations and simulations will be blocked. To continue using LangWatch with a bigger limit, please upgrade your plan."}
    </EmailParagraph>
    <ProjectTable
      projectUsageData={projectUsageData}
      currentMonthMessagesCount={currentMonthMessagesCount}
      actionUrl={actionUrl}
    />
    <UsageMeter
      usagePercentage={usagePercentage}
      usagePercentageFormatted={usagePercentageFormatted}
      currentMonthMessagesCount={currentMonthMessagesCount}
      maxMonthlyUsageLimit={maxMonthlyUsageLimit}
    />
    <EmailAction href={actionUrl} label="View Usage Details" />
    <EmailParagraph tone="muted" style={{ fontSize: EMAIL_TYPE.small.size }}>
      If you want to upgrade your plan, you can do so here as well.
    </EmailParagraph>
  </EmailShell>
);

export const sendUsageLimitEmail = async ({
  to,
  organizationName,
  usagePercentage,
  usagePercentageFormatted,
  currentMonthMessagesCount,
  maxMonthlyUsageLimit,
  crossedThreshold,
  projectUsageData,
  actionUrl,
  logoUrl,
  severity,
}: UsageLimitEmailProps & {
  to: string;
  severity: string;
}) => {
  const subject = `Usage Limit ${severity} - ${usagePercentageFormatted}% of limit reached`;

  const emailHtml = await render(
    <UsageLimitEmailTemplate
      organizationName={organizationName}
      usagePercentage={usagePercentage}
      usagePercentageFormatted={usagePercentageFormatted}
      currentMonthMessagesCount={currentMonthMessagesCount}
      maxMonthlyUsageLimit={maxMonthlyUsageLimit}
      crossedThreshold={crossedThreshold}
      projectUsageData={projectUsageData}
      actionUrl={actionUrl}
      logoUrl={logoUrl}
    />,
  );

  await sendEmail({
    to,
    subject,
    html: emailHtml,
  });
};
