// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { SimpleGrid } from "@chakra-ui/react";
import { type GovernanceCostProviderDayRow } from "@langwatch/enterprise-governance-contract";

import { type SampleSeries } from "../../behavior/use-sample-series.ts";
import { type Breakdowns } from "../../model/breakdowns.ts";
import { ADD_A_SOURCE, MANAGE_DEPARTMENTS } from "../../model/cost-panel-copy.ts";
import { type MeasuredRows } from "../../model/measured-rows.ts";
import { type TimeInterval } from "../../model/time-controls.ts";
import { CostRankList } from "../blocks/cost-rank-list.tsx";
import { costPanelEmpty } from "../elements/cost-panel-empty.tsx";
import { CostPanel } from "../elements/cost-panel.tsx";
import { AgentRankPanel, AgentSharePanel } from "./agent-panels.tsx";
import { CostTotalPanel, ProviderPanelSlot } from "./cost-total-panel.tsx";
import { CostPanelUnrefreshed } from "./costs-notices.tsx";
import { CountPanels } from "./count-panels.tsx";
import { MeteredPersonPanel } from "./headline-panels.tsx";
import { SpenderPanelSlot, type SpenderReadState } from "./spender-panel-slot.tsx";

/**
 * The breakdown grid: four measured panels, the spender list, and the invented
 * ones interleaved in the prototype's order.
 *
 * Sample mode replaces every measured series in the grid.
 */
export function BreakdownGrid({
  interval,
  rows,
  failed,
  sample,
  showSample,
  spenders,
  organizationId,
  providerDays,
  hasProviderDaysFailure,
}: {
  interval: TimeInterval;
  /** Every measured series, already folded and filtered. Null is unanswered. */
  rows: MeasuredRows;
  /** Which reads FAILED, as opposed to answering nothing. */
  failed: Breakdowns["failed"];
  sample: SampleSeries;
  showSample: boolean;
  spenders: SpenderReadState;
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
  const orSample = <T,>(measured: T[] | null, samples: T[]): T[] | null =>
    showSample ? samples : measured;
  // Sample mode outranks a failed read: the reader asked to be shown invented
  // figures, and a failure notice over the top of them would be reporting on a
  // read this screen is not currently showing.
  const unrefreshed = (which: keyof Breakdowns["failed"]) => !showSample && failed[which];

  return (
    <SimpleGrid columns={{ base: 1, xl: 3 }} gap={4}>
      <AgentSharePanel sample={sample} showSample={showSample} />
      <CostTotalPanel
        providerDays={providerDays}
        hasFailure={hasProviderDaysFailure}
        interval={interval}
        sample={sample}
        showSample={showSample}
      />
      <ProviderPanelSlot
        organizationId={organizationId}
        providerDays={providerDays}
        hasFailure={hasProviderDaysFailure}
        interval={interval}
        showSample={showSample}
      />
      <CostPanel title="Cost by department" sample={showSample} tourId="gov-cost-by-department">
        {unrefreshed("byDepartment") ? (
          <CostPanelUnrefreshed />
        ) : (
          <CostRankList
            rows={orSample(rows.byDepartment, sample.departments)}
            empty={costPanelEmpty({
              what: "Spend split across the departments people belong to.",
              source: "Fills once people who are spending are assigned to a department.",
              action: MANAGE_DEPARTMENTS,
            })}
          />
        )}
      </CostPanel>

      <AgentRankPanel sample={sample} showSample={showSample} />
      <CostPanel title="Cost by model" sample={showSample}>
        {unrefreshed("byModel") ? (
          <CostPanelUnrefreshed />
        ) : (
          <CostRankList
            rows={orSample(rows.byModel, sample.models)}
            empty={costPanelEmpty({
              what: "Spend per model, largest first.",
              // The billed lane only, so the copy no longer promises gateway
              // traffic will fill it: this read is the same rollup the billed
              // panels use, and naming a source that cannot feed it is the
              // kind of advice that leaves a reader waiting on nothing.
              source: "Fills from the bills a connected source reports.",
              action: ADD_A_SOURCE,
            })}
          />
        )}
      </CostPanel>
      <MeteredPersonPanel
        rows={rows.byUser}
        sample={sample}
        showSample={showSample}
        unrefreshed={unrefreshed("byUser")}
      />
      <SpenderPanelSlot spenders={spenders} showSample={showSample} />

      <CountPanels sample={sample} interval={interval} showSample={showSample} />
    </SimpleGrid>
  );
}
