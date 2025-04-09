import { AlertCircle, CheckCircle, Activity } from "react-feather";
import type { SystemStyleObject } from "@chakra-ui/react";
import type { ReactNode } from "react";

type StatusType = "error" | "warning" | "healthy";

export const getStatusColor = (status: StatusType, value: number): Record<string, string> => {
  if (status === "error") return { bg: "red.50", color: "red.800", borderColor: "red.200" };
  if (status === "warning" || value < 0.8) return { bg: "amber.50", color: "amber.800", borderColor: "amber.200" };
  return { bg: "green.50", color: "green.800", borderColor: "green.200" };
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