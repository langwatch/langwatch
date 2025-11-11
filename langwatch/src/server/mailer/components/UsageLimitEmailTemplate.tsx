import React from "react";
import { Html } from "@react-email/html";
import { Button } from "@react-email/button";
import { Container } from "@react-email/container";
import { Heading } from "@react-email/heading";
import { Img } from "@react-email/img";
import { Text } from "@react-email/text";
import { Section } from "@react-email/section";
import type { UsageLimitEmailProps } from "../types/usage-limit-email/usage-limit-email-props";
import { getProgressBarColor } from "./helpers/get-progress-bar-color";
import { ProjectUsageTable } from "./usage-limit/ProjectUsageTable";
import { UsageProgressBar } from "./usage-limit/UsageProgressBar";
import { EMAIL_CONFIG } from "../config/email-constants";

/**
 * Email template for usage limit warnings
 * Single Responsibility: Compose email layout from smaller components
 */
export function UsageLimitEmailTemplate({
  organizationName,
  usagePercentage,
  usagePercentageFormatted,
  currentMonthMessagesCount,
  maxMonthlyUsageLimit,
  crossedThreshold,
  projectUsageData,
  actionUrl,
  logoUrl,
}: UsageLimitEmailProps) {
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
            You&apos;ve consumed {usagePercentageFormatted}% of your monthly
            message limit
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

        <Section
          style={{
            backgroundColor: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            marginBottom: "24px",
            overflow: "hidden",
          }}
        >
          <ProjectUsageTable
            projectUsageData={projectUsageData}
            currentMonthMessagesCount={currentMonthMessagesCount}
            actionUrl={actionUrl}
          />
        </Section>

        <UsageProgressBar
          currentMonthMessagesCount={currentMonthMessagesCount}
          maxMonthlyUsageLimit={maxMonthlyUsageLimit}
          usagePercentageFormatted={usagePercentageFormatted}
          progressBarColor={progressBarColor}
          progressBarWidth={progressBarWidth}
        />

        <Section style={{ textAlign: "center", marginBottom: "32px" }}>
          <Button
            href={actionUrl}
            style={{
              backgroundColor: EMAIL_CONFIG.BRAND_COLOR,
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
              href={EMAIL_CONFIG.HELP_CENTER_URL}
              style={{ color: EMAIL_CONFIG.BRAND_COLOR, textDecoration: "none" }}
            >
              Help Center
            </a>{" "}
            for more information or feel free to reach out to us. Our support
            engineers are here to help.
          </Text>
        </Section>
      </Container>
    </Html>
  );
}

