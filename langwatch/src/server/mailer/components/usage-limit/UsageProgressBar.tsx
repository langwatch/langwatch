import React from "react";
import { Text } from "@react-email/text";
import { Section } from "@react-email/section";

interface UsageProgressBarProps {
  currentMonthMessagesCount: number;
  maxMonthlyUsageLimit: number;
  usagePercentageFormatted: string;
  progressBarColor: string;
  progressBarWidth: number;
}

/**
 * Usage progress bar for email
 * Single Responsibility: Render usage progress visualization
 */
export function UsageProgressBar({
  currentMonthMessagesCount,
  maxMonthlyUsageLimit,
  usagePercentageFormatted,
  progressBarColor,
  progressBarWidth,
}: UsageProgressBarProps) {
  return (
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
}

