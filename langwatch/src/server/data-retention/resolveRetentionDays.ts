import type { RetentionCategory, RetentionPolicy } from "./retentionPolicy.schema";

interface ResolveRetentionDaysParams {
  category: RetentionCategory;
  projectRetentionPolicy: RetentionPolicy | null;
  orgDefaultRetentionPolicy: RetentionPolicy | null;
}

export function resolveRetentionDays({
  category,
  projectRetentionPolicy,
  orgDefaultRetentionPolicy,
}: ResolveRetentionDaysParams): number {
  const projectValue = projectRetentionPolicy?.[category];
  if (projectValue != null) return projectValue;

  const orgValue = orgDefaultRetentionPolicy?.[category];
  if (orgValue != null) return orgValue;

  return 0;
}
