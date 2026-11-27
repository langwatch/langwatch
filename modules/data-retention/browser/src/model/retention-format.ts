import { ENTERPRISE_RETENTION_PRESETS } from "./retention-constants.ts";

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB", "EB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(2)} ${units[i]}`;
}

/** A preset's stored value (whole weeks, so a little longer) reads as the preset's label. */
export function formatDays(days: number): string {
  if (days === 0) return "Indefinite";
  const preset = ENTERPRISE_RETENTION_PRESETS.find((p) => p.days === days);
  return preset ? preset.label : `${days} days`;
}
