import type { ReactNode } from "react";
import { Activity, AlertCircle, CheckCircle } from "react-feather";

type StatusType = "error" | "warning" | "healthy";

export const getStatusColor = (
  status: StatusType,
  value: number,
): Record<string, string> => {
  if (status === "error")
    return { bg: "red.subtle", color: "red.fg", borderColor: "red.emphasized" };
  if (status === "warning" || value < 0.8)
    return {
      bg: "yellow.subtle",
      color: "yellow.fg",
      borderColor: "yellow.emphasized",
    };
  return {
    bg: "green.subtle",
    color: "green.fg",
    borderColor: "green.emphasized",
  };
};

export const getStatusIcon = (status: StatusType, value: number): ReactNode => {
  if (status === "error" || value < 0.7) return <AlertCircle size={16} />;
  if (status === "warning" || value < 0.8) return <Activity size={16} />;
  return <CheckCircle size={16} />;
};

export const getChartColor = (status: StatusType, value: number): string => {
  if (status === "error" || value < 0.7) return "#ef4444";
  if (status === "warning" || value < 0.8) return "#f59e0b";
  return "#22c55e";
};
