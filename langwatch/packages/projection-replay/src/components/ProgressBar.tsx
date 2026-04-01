import React from "react";
import { Text } from "ink";

interface ProgressBarProps {
  current: number;
  total: number;
  width?: number;
  unit?: string;
  rate?: number;
}

export function ProgressBar({
  current,
  total,
  width = 30,
  unit,
  rate,
}: ProgressBarProps) {
  const pct = total > 0 ? Math.min(current / total, 1) : 0;
  const filled = Math.round(pct * width);
  const empty = width - filled;
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(empty);
  const pctStr = `${Math.round(pct * 100)}%`.padStart(4);

  const counts = `${current.toLocaleString()}/${total.toLocaleString()}`;
  const unitStr = unit ? ` ${unit}` : "";
  const rateStr = rate != null && rate > 0 ? `  ${rate.toFixed(1)}/s` : "";

  return (
    <Text>
      {bar} {pctStr}  {counts}
      {unitStr}
      {rateStr}
    </Text>
  );
}
