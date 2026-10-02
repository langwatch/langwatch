import { retentionCategories, type RetentionCategory } from "@langwatch/data-retention-contract";
import { HStack, Spinner, Text } from "@langwatch/design-system/primitives";
import { OverviewCard, SettingRow } from "@langwatch/design-system/settings-card";

import { CATEGORY_LABELS } from "../../model/retention-constants.ts";
import { formatBytes, formatDays } from "../../model/retention-format.ts";
import { renderPolicySummary } from "../../model/retention-grouping.ts";

export function RetentionAndUsageCard({
  effective,
  isLoading,
  data,
  storageDescription = "How much space this project's data uses today.",
}: {
  effective: Partial<Record<RetentionCategory, number>>;
  isLoading: boolean;
  data?: { totalBytes: number; projectCount?: number };
  /** Scope-aware copy for the storage row — the storage total tracks the
   *  page's scope selector, so the sentence must match (project / team / org /
   *  everything you can see). */
  storageDescription?: string;
}) {
  const summary = renderPolicySummary(effective);
  return (
    <OverviewCard
      title="Data retention"
      hint="How long this project's data is kept before deletion, and how much space it uses."
    >
      <SettingRow label="Retention">
        <Text fontSize="13px" fontWeight="500">
          {summary}
        </Text>
      </SettingRow>
      {summary === "Mixed" &&
        retentionCategories.map((category) => (
          <SettingRow key={category} label={CATEGORY_LABELS[category]}>
            <Text fontSize="13px" color="fg.muted">
              {effective[category] !== undefined ? formatDays(effective[category]!) : "—"}
            </Text>
          </SettingRow>
        ))}
      <SettingRow label="Data storage" hint={storageDescription}>
        {isLoading && <Spinner size="sm" />}
        {!isLoading && data && (
          <HStack gap={1.5} align="baseline">
            <Text fontSize="13px" fontWeight="500">
              {formatBytes(data.totalBytes)}
            </Text>
            {data.projectCount !== undefined && data.projectCount > 1 && (
              <Text fontSize="xs" color="fg.muted">
                · {data.projectCount} projects
              </Text>
            )}
          </HStack>
        )}
      </SettingRow>
    </OverviewCard>
  );
}
