import { retentionCategories, type RetentionCategory } from "@langwatch/data-retention-contract";
import { HStack, Skeleton, Text } from "@langwatch/design-system/primitives";
import { StatTile, StatTileFigure, StatTileGrid } from "@langwatch/design-system/stat-tile";
import { Clock, HardDrive } from "lucide-react";

import { CATEGORY_LABELS } from "../../model/retention-constants.ts";
import { formatBytes, formatDays } from "../../model/retention-format.ts";
import { renderPolicySummary } from "../../model/retention-grouping.ts";

/** The page's summary row: how long data is kept, and how much space it takes. */
export function RetentionAndUsageCard({
  effective,
  isLoading,
  data,
  storageDescription = "How much space this project's data uses today.",
}: {
  effective: Partial<Record<RetentionCategory, number>>;
  isLoading: boolean;
  data?: { totalBytes: number; projectCount?: number };
  /** Scope-aware copy for the storage tile: it tracks the page's scope selector. */
  storageDescription?: string;
}) {
  const summary = renderPolicySummary(effective);
  const perCategory = retentionCategories
    .map((category) => {
      const days = effective[category];
      return `${CATEGORY_LABELS[category]} ${days === undefined ? "—" : formatDays(days)}`;
    })
    .join(" · ");

  return (
    <StatTileGrid columns={2}>
      <StatTile
        label="Retention"
        icon={<Clock size={14} />}
        hint={summary === "Mixed" ? perCategory : "How long data is kept before deletion."}
      >
        <StatTileFigure>{summary}</StatTileFigure>
      </StatTile>
      <StatTile label="Data storage" icon={<HardDrive size={14} />} hint={storageDescription}>
        {isLoading && <Skeleton height="5" width="24" />}
        {!isLoading && data && (
          <HStack gap={1.5} align="baseline" minWidth={0}>
            <StatTileFigure>{formatBytes(data.totalBytes)}</StatTileFigure>
            {data.projectCount !== undefined && data.projectCount > 1 && (
              <Text fontSize="sm" color="fg.muted">
                · {data.projectCount} projects
              </Text>
            )}
          </HStack>
        )}
      </StatTile>
    </StatTileGrid>
  );
}
