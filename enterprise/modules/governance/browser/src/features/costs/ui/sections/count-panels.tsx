// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { type SampleSeries } from "../../behavior/use-sample-series.ts";
import { fmtWhole } from "../../model/cost-figure-format.ts";
import { ADD_A_SOURCE, AWAITING_A_READ } from "../../model/cost-panel-copy.ts";
import { type TimeInterval } from "../../model/time-controls.ts";
import { CostLine } from "../blocks/cost-line.tsx";
import { CostStackedBars } from "../blocks/cost-stacked-bars.tsx";
import { costPanelEmpty } from "../elements/cost-panel-empty.tsx";
import { CostPanel } from "../elements/cost-panel.tsx";

/**
 * The two count panels that close the grid.
 *
 * "Conversations", not "Genie questions". Genie is one of eight ingestion
 * sources (docs/ai-governance/overview.mdx) and no metric in the ADR or the
 * product docs is named after it; a panel named for one provider reads as
 * empty to every customer using another.
 *
 * The two panels count different KINDS of thing and are formatted apart on
 * purpose. Conversations are a tally — somebody could in principle count them,
 * and a reader comparing quarters wants the figure, so the axis spells it out.
 * Tokens are throughput nobody holds in their head, so that axis abbreviates.
 * Both used the abbreviating formatter until the conversations axis read
 * "4.6k" beside the token axis reading "3.4B", which made a few thousand
 * support chats look like a unit of machine consumption.
 */
export function CountPanels({
  sample,
  interval,
  showSample,
}: {
  sample: SampleSeries;
  interval: TimeInterval;
  showSample: boolean;
}) {
  return (
    <>
      <CostPanel title="Conversations over time" sample={showSample}>
        <CostStackedBars
          buckets={showSample ? sample.conversations : AWAITING_A_READ}
          format={fmtWhole}
          interval={interval}
          showLegend={false}
          empty={costPanelEmpty({
            what: "How many conversations were held, period by period.",
            source: "Fills from traffic the gateway serves.",
            action: ADD_A_SOURCE,
          })}
        />
      </CostPanel>
      <CostPanel title="Tokens over time" sample={showSample}>
        <CostLine
          points={showSample ? sample.tokens : AWAITING_A_READ}
          interval={interval}
          empty={costPanelEmpty({
            what: "How many tokens were spent, period by period.",
            source: "Fills from traffic the gateway serves.",
            action: ADD_A_SOURCE,
          })}
        />
      </CostPanel>
    </>
  );
}
