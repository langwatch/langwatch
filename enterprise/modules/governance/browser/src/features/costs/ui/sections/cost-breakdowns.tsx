// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { VStack } from "@chakra-ui/react";
import { type GovernanceCostProviderDayRow } from "@langwatch/enterprise-governance-contract";

import { useSampleSeries } from "../../behavior/use-sample-series.ts";
import { type Breakdowns } from "../../model/breakdowns.ts";
import { type CostFilters } from "../../model/cost-filters.ts";
import { measuredRows } from "../../model/measured-rows.ts";
import { AdoptionRow } from "./adoption-figures.tsx";
import { BreakdownGrid } from "./breakdown-grid.tsx";
import { HeadlinePanels } from "./headline-panels.tsx";
import { type SpenderReadState } from "./spender-panel-slot.tsx";

/**
 * Everything below the lanes: the adoption strip, the sample-only headline
 * pair, and the breakdown grid.
 *
 * The wire rows are mapped to chart rows here rather than in the grid because
 * this is where the department filter applies, and the mapping has to carry
 * null through: an unanswered read stays unanswered all the way to the panel
 * rather than turning into an empty list, which would read as a measurement.
 */
export function CostBreakdowns({
  filters,
  breakdowns,
  periods,
  showSample,
  spenders,
  sourcesConnected: connected,
  organizationId,
  providerDays,
  hasProviderDaysFailure,
}: {
  filters: CostFilters;
  breakdowns: Breakdowns;
  /** The bucket starts the sample series are drawn on. */
  periods: string[];
  showSample: boolean;
  spenders: SpenderReadState;
  /** See `sourcesConnected`: the Adoption count cannot state its own absence. */
  sourcesConnected: boolean;
  organizationId: string;
  /**
   * One figure per (day, provider) of the billed lane. NULL UNTIL THE READ
   * ANSWERS, which an empty list cannot say on its own: the panels below
   * draw an unanswered read and a measured-empty window in different
   * words, and collapsing the two here would have them state a finding
   * nobody measured.
   */
  providerDays: readonly GovernanceCostProviderDayRow[] | null;
  /**
   * Whether that read FAILED, which an empty row list cannot say on its own.
   * Without it a failed read is an empty list, an empty list hides the panel,
   * and a hidden panel beside filled neighbours reads as no spend — the same
   * confusion `CostPanelUnrefreshed` exists to prevent.
   */
  hasProviderDaysFailure: boolean;
}) {
  const sample = useSampleSeries(periods, filters.interval, filters.department);
  const rows = measuredRows({ breakdowns, filters });

  return (
    <VStack align="stretch" gap={4}>
      <AdoptionRow breakdowns={breakdowns} showSample={showSample} sourcesConnected={connected} />
      <HeadlinePanels sample={sample} interval={filters.interval} showSample={showSample} />
      <BreakdownGrid
        interval={filters.interval}
        rows={rows}
        failed={breakdowns.failed}
        sample={sample}
        showSample={showSample}
        spenders={spenders}
        organizationId={organizationId}
        providerDays={providerDays}
        hasProviderDaysFailure={hasProviderDaysFailure}
      />
    </VStack>
  );
}
