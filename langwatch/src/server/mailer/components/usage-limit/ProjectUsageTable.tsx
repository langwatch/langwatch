import React from "react";
import type { ProjectUsageData } from "../../types/usage-limit-email.types";
import { EMAIL_CONFIG } from "../../config/email-constants";

interface ProjectUsageTableProps {
  projectUsageData: ProjectUsageData[];
  currentMonthMessagesCount: number;
  actionUrl: string;
}

/**
 * Project usage table for email
 * Single Responsibility: Render project usage breakdown
 */
export function ProjectUsageTable({
  projectUsageData,
  currentMonthMessagesCount,
  actionUrl,
}: ProjectUsageTableProps) {
  return (
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
          <tr key={project.id} style={{ borderBottom: "1px solid #e5e7eb" }}>
            <td
              style={{ padding: "12px 16px", fontSize: "14px", color: "#1f2937" }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: "12px",
                  height: "12px",
                  backgroundColor: EMAIL_CONFIG.BRAND_COLOR,
                  borderRadius: "2px",
                  marginRight: "8px",
                  verticalAlign: "middle",
                }}
              />
              <a
                href={actionUrl}
                style={{ color: EMAIL_CONFIG.BRAND_COLOR, textDecoration: "none" }}
              >
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
        ))}
        <tr
          style={{ borderTop: "2px solid #e5e7eb", backgroundColor: "#f9fafb" }}
        >
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
      </tbody>
    </table>
  );
}

