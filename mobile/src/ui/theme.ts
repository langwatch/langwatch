import { useColorScheme } from "react-native";

import type { Severity } from "@/lib/ops";

/**
 * One palette, two schemes. Severity is the only colour vocabulary in the app,
 * so "red" always means the same thing — something needs an operator — rather
 * than merely that a number is large.
 */
const light = {
  background: "#f4f4f5",
  card: "#ffffff",
  border: "#e4e4e7",
  text: "#18181b",
  textMuted: "#71717a",
  accent: "#1d4a73",
  normal: "#18181b",
  warning: "#b45309",
  critical: "#b91c1c",
  good: "#15803d",
};

const dark = {
  background: "#09090b",
  card: "#18181b",
  border: "#27272a",
  text: "#fafafa",
  textMuted: "#a1a1aa",
  accent: "#4f9ddb",
  normal: "#fafafa",
  warning: "#fbbf24",
  critical: "#f87171",
  good: "#4ade80",
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}

export function severityColor(theme: Theme, severity: Severity): string {
  switch (severity) {
    case "critical":
      return theme.critical;
    case "warning":
      return theme.warning;
    case "normal":
      return theme.normal;
  }
}
