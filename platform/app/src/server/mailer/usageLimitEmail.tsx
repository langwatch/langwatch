import {
  Button,
  Container,
  Heading,
  Html,
  Img,
  Section,
  Text,
} from "@react-email/components";
import { render } from "@react-email/render";
import { sendEmail } from "./emailSender";

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

/** Progress bar color for the given usage percentage; mirrors the severity bands used across the email. */
const getProgressBarColor = (usagePercentage: number): string => {
  if (usagePercentage >= 100) {
    return "#dc2626"; // red
  } else if (usagePercentage >= 95) {
    return "#dc2626"; // red
  } else if (usagePercentage >= 90) {
    return "#f59e0b"; // orange
  } else if (usagePercentage >= 70) {
    return "#f59e0b"; // orange
  } else {
    return "#10b981"; // green
  }
};

const EmailHeader = ({ logoUrl }: { logoUrl: string }) => (
  <Section style={{ textAlign: "center", marginBottom: "32px" }}>
    <Img
      src={logoUrl}
      alt="LangWatch"
      width="558"
      style={{
        outline: "none",
        textDecoration: "none",
        maxWidth: "100%",
        fontSize: "16px",
        width: "100%",
        height: "auto",
      }}
    />
  </Section>
);

const UsageSummary = ({
  usagePercentageFormatted,
  organizationName,
  crossedThreshold,
}: {
  usagePercentageFormatted: string;
  organizationName: string;
  crossedThreshold: number;
}) => (
  <Section style={{ marginBottom: "30px" }}>
    <Heading
      as="h1"
      style={{
        fontSize: "24px",
        fontWeight: 600,
        color: "#1f2937",
        margin: "0 0 16px 0",
      }}
    >
      You&apos;ve consumed {usagePercentageFormatted}% of your monthly message
      limit
    </Heading>
    <Text
      style={{
        fontSize: "16px",
        color: "#4b5563",
        lineHeight: 1.5,
        margin: "0 0 24px 0",
      }}
    >
      Your organization, <strong>{organizationName}</strong>, has consumed{" "}
      {usagePercentageFormatted}% of its monthly message limit.{" "}
      {crossedThreshold >= 100
        ? "To continue using LangWatch, please upgrade your plan."
        : "New traces are going to get dropped soon, evaluations and simulations will be blocked. To continue using LangWatch with a bigger limit, please upgrade your plan."}
    </Text>
  </Section>
);

const ProjectUsageRow = ({
  project,
  actionUrl,
}: {
  project: ProjectUsageData;
  actionUrl: string;
}) => (
  <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
    <td style={{ padding: "12px 16px", fontSize: "14px", color: "#1f2937" }}>
      <span
        style={{
          display: "inline-block",
          width: "12px",
          height: "12px",
          backgroundColor: "#ED8926",
          borderRadius: "2px",
          marginRight: "8px",
          verticalAlign: "middle",
        }}
      />
      <a href={actionUrl} style={{ color: "#ED8926", textDecoration: "none" }}>
        {project.name}
      </a>
    </td>
    <td
      style={{
        padding: "12px 16px",
        fontSize: "14px",
        color: "#1f2937",
        textAlign: "right",
      }}
    >
      {project.messageCount.toLocaleString()}
    </td>
  </tr>
);

const TotalUsageRow = ({
  projectUsageData,
  currentMonthMessagesCount,
}: {
  projectUsageData: ProjectUsageData[];
  currentMonthMessagesCount: number;
}) => (
  <tr style={{ borderTop: "2px solid #e5e7eb", backgroundColor: "#f9fafb" }}>
    <td
      style={{
        padding: "12px 16px",
        fontSize: "14px",
        fontWeight: 600,
        color: "#1f2937",
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: "12px",
          height: "12px",
          backgroundColor: "#9ca3af",
          borderRadius: "2px",
          marginRight: "8px",
          verticalAlign: "middle",
        }}
      />
      {`Total (${projectUsageData.length})`}
    </td>
    <td
      style={{
        padding: "12px 16px",
        fontSize: "14px",
        fontWeight: 600,
        color: "#1f2937",
        textAlign: "right",
      }}
    >
      {currentMonthMessagesCount.toLocaleString()}
    </td>
  </tr>
);

const ProjectUsageTable = ({
  projectUsageData,
  actionUrl,
  currentMonthMessagesCount,
}: {
  projectUsageData: ProjectUsageData[];
  actionUrl: string;
  currentMonthMessagesCount: number;
}) => (
  <Section
    style={{
      backgroundColor: "#ffffff",
      border: "1px solid #e5e7eb",
      borderRadius: "8px",
      marginBottom: "24px",
      overflow: "hidden",
    }}
  >
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr
          style={{
            backgroundColor: "#f9fafb",
            borderBottom: "1px solid #e5e7eb",
          }}
        >
          <th
            style={{
              padding: "12px 16px",
              textAlign: "left",
              fontSize: "12px",
              fontWeight: 600,
              color: "#6b7280",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            PROJECT
          </th>
          <th
            style={{
              padding: "12px 16px",
              textAlign: "right",
              fontSize: "12px",
              fontWeight: 600,
              color: "#6b7280",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            MESSAGES
          </th>
        </tr>
      </thead>
      <tbody>
        {projectUsageData.map((project) => (
          <ProjectUsageRow
            key={project.id}
            project={project}
            actionUrl={actionUrl}
          />
        ))}
        <TotalUsageRow
          projectUsageData={projectUsageData}
          currentMonthMessagesCount={currentMonthMessagesCount}
        />
      </tbody>
    </table>
  </Section>
);

const UsageProgressSection = ({
  currentMonthMessagesCount,
  maxMonthlyUsageLimit,
  usagePercentageFormatted,
  progressBarColor,
  progressBarWidth,
}: {
  currentMonthMessagesCount: number;
  maxMonthlyUsageLimit: number;
  usagePercentageFormatted: string;
  progressBarColor: string;
  progressBarWidth: number;
}) => (
  <Section
    style={{
      backgroundColor: "#f9fafb",
      borderRadius: "8px",
      padding: "24px",
      marginBottom: "24px",
    }}
  >
    <Section style={{ marginBottom: "16px" }}>
      <Section
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "8px",
        }}
      >
        <Text
          style={{
            fontSize: "14px",
            fontWeight: 500,
            color: "#374151",
            margin: 0,
          }}
        >
          Messages{" "}
        </Text>
        <Text
          style={{
            fontSize: "14px",
            fontWeight: 600,
            color: progressBarColor,
            margin: 0,
          }}
        >
          {currentMonthMessagesCount.toLocaleString()} /{" "}
          {maxMonthlyUsageLimit.toLocaleString()}
        </Text>
      </Section>
      <div
        style={{
          backgroundColor: "#e5e7eb",
          borderRadius: "4px",
          height: "8px",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            backgroundColor: progressBarColor,
            height: "100%",
            width: `${progressBarWidth}%`,
            borderRadius: "4px",
            transition: "width 0.3s ease",
          }}
        />
      </div>
    </Section>
    <Section
      style={{
        marginTop: "16px",
        paddingTop: "16px",
        borderTop: "1px solid #e5e7eb",
      }}
    >
      <Section
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Text style={{ fontSize: "14px", color: "#6b7280", margin: 0 }}>
          Usage Percentage{" "}
        </Text>
        <Text
          style={{
            fontSize: "16px",
            fontWeight: 600,
            color: progressBarColor,
            margin: 0,
          }}
        >
          {usagePercentageFormatted}%
        </Text>
      </Section>
    </Section>
  </Section>
);

const UsageCtaSection = ({ actionUrl }: { actionUrl: string }) => (
  <Section style={{ textAlign: "center", marginBottom: "32px" }}>
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
      View Usage Details
    </Button>
    <Text
      style={{
        fontSize: "13px",
        color: "#6b7280",
        marginTop: "12px",
        marginBottom: 0,
      }}
    >
      If you want to upgrade your plan, you can do so here as well.
    </Text>
  </Section>
);

const EmailFooter = () => (
  <Section
    style={{
      borderTop: "1px solid #e5e7eb",
      paddingTop: "24px",
      marginTop: "32px",
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
      for more information or feel free to reach out to us. Our support
      engineers are here to help.
    </Text>
  </Section>
);

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
}: UsageLimitEmailProps) => {
  const progressBarColor = getProgressBarColor(usagePercentage);
  const progressBarWidth = Math.min(usagePercentage, 100);

  return (
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
        <EmailHeader logoUrl={logoUrl} />

        <UsageSummary
          usagePercentageFormatted={usagePercentageFormatted}
          organizationName={organizationName}
          crossedThreshold={crossedThreshold}
        />

        <ProjectUsageTable
          projectUsageData={projectUsageData}
          actionUrl={actionUrl}
          currentMonthMessagesCount={currentMonthMessagesCount}
        />

        <UsageProgressSection
          currentMonthMessagesCount={currentMonthMessagesCount}
          maxMonthlyUsageLimit={maxMonthlyUsageLimit}
          usagePercentageFormatted={usagePercentageFormatted}
          progressBarColor={progressBarColor}
          progressBarWidth={progressBarWidth}
        />

        <UsageCtaSection actionUrl={actionUrl} />

        <EmailFooter />
      </Container>
    </Html>
  );
};

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
