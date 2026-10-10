// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { type SampleSeries } from "../../behavior/use-sample-series.ts";
import { AGENTS_ARE_UNATTRIBUTED, AWAITING_A_READ } from "../../model/cost-panel-copy.ts";
import { CostDonut } from "../blocks/cost-donut.tsx";
import { CostRankList } from "../blocks/cost-rank-list.tsx";
import { costPanelEmpty } from "../elements/cost-panel-empty.tsx";
import { CostPanel } from "../elements/cost-panel.tsx";

/**
 * The two agent breakdowns, which have no read behind them yet.
 *
 * Extracted from the grid rather than inlined for the reason the file splits
 * `SpenderPanelSlot` out: each is a panel plus five lines of empty copy, and
 * the two of them inlined pushed the grid past the length the linter allows
 * and buried the shape of the grid under the wording of its cells. See
 * `AWAITING_A_READ` for what their empty state is claiming and what it is not.
 */
export function AgentSharePanel({
  sample,
  showSample,
}: {
  sample: SampleSeries;
  showSample: boolean;
}) {
  return (
    <CostPanel title="Share of cost by agent" sample={showSample}>
      <CostDonut
        rows={showSample ? sample.agents : AWAITING_A_READ}
        empty={costPanelEmpty({
          what: "How the spend splits across the agents that ran it.",
          ...AGENTS_ARE_UNATTRIBUTED,
        })}
      />
    </CostPanel>
  );
}

export function AgentRankPanel({
  sample,
  showSample,
}: {
  sample: SampleSeries;
  showSample: boolean;
}) {
  return (
    <CostPanel title="Cost by agent" sample={showSample}>
      <CostRankList
        rows={showSample ? sample.agents : AWAITING_A_READ}
        empty={costPanelEmpty({
          what: "Spend per agent, largest first.",
          ...AGENTS_ARE_UNATTRIBUTED,
        })}
      />
    </CostPanel>
  );
}
