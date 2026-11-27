import {
  AGENT_REGISTRY_DORMANT_AFTER_DAYS_MAX,
  AGENT_REGISTRY_DORMANT_AFTER_DAYS_MIN,
} from "@langwatch/enterprise-governance-contract";

/** The typed dormancy window as a whole number of days in range, or null while it is not one. */
export function parseDormancyDays(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const days = Number(text);
  if (days < AGENT_REGISTRY_DORMANT_AFTER_DAYS_MIN) return null;
  if (days > AGENT_REGISTRY_DORMANT_AFTER_DAYS_MAX) return null;
  return days;
}
