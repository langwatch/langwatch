// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { VStack } from "@chakra-ui/react";
import { type GovernanceCostProviderDayRow } from "@langwatch/enterprise-governance-contract";
import { useMemo } from "react";

import { type SampleSeries } from "../../behavior/use-sample-series.ts";
import { ADD_A_SOURCE } from "../../model/cost-panel-copy.ts";
import { costTotalBuckets } from "../../model/provider-day-buckets.ts";
import { partialProviderNotes } from "../../model/provider-periods.ts";
import { type TimeInterval } from "../../model/time-controls.ts";
import { CostStackedBars } from "../blocks/cost-stacked-bars.tsx";
import { PartialSpendNote } from "../blocks/partial-spend-note.tsx";
import { costPanelEmpty } from "../elements/cost-panel-empty.tsx";
import { CostPanel } from "../elements/cost-panel.tsx";
import { CostProviderDayPanel } from "./cost-provider-day-panel.tsx";
import { CostPanelUnrefreshed } from "./costs-notices.tsx";

/**
 * What the organization spent, period by period, with nothing split out.
 *
 * The panel that used to sit here charted spend by TEAM, and a team is not a
 * dimension this product's cost rows carry — so outside sample mode every bar
 * it ever drew was one unattributed block, and the read behind it went to the
 * metered trace store for the privilege. It was removed with its read.
 *
 * This replaces it from the rows the screen already has. `dailyByProvider`
 * answers a figure per (day, provider); adding the providers up per period is
 * the whole of this chart, so it costs no query and cannot disagree with the
 * stacked panel beside it about any period.
 */
export function CostTotalPanel({
  providerDays,
  hasFailure,
  interval,
  sample,
  showSample,
}: {
  providerDays: readonly GovernanceCostProviderDayRow[] | null;
  hasFailure: boolean;
  interval: TimeInterval;
  sample: SampleSeries;
  showSample: boolean;
}) {
  const measured = useMemo(
    () => (providerDays === null ? null : costTotalBuckets(providerDays, interval)),
    [providerDays, interval],
  );
  // A period short in the provider split beside this is short here too —
  // same rows, same fold — and both panels say so in the same words. A bar
  // drawn at the sum of the days that held a figure reads as a cheap period
  // unless something says the figure is not whole; the bar is drawn short
  // (see `CostStackedBars`) and this line says who left it short. Read off
  // the buckets the chart draws, so the note names exactly the providers
  // whose bars are marked.
  const partialProviders = useMemo(
    () => (measured === null ? [] : partialProviderNotes(measured)),
    [measured],
  );
  return (
    <CostPanel title="Cost over time" sample={showSample} tourId="gov-cost-over-time">
      {!showSample && hasFailure ? (
        <CostPanelUnrefreshed />
      ) : (
        <VStack align="stretch" gap={2}>
          <CostStackedBars
            buckets={showSample ? sample.overTime : measured}
            interval={interval}
            // The measured chart is ONE series and the axis already says it
            // is money, so a legend there spends a line repeating the panel's
            // own title. The invented one still carries several, and those do
            // need naming.
            showLegend={showSample}
            empty={costPanelEmpty({
              what: "What was spent, period by period.",
              source: "Fills from the bills a connected source reports.",
              action: ADD_A_SOURCE,
            })}
          />
          {!showSample && <PartialSpendNote providers={partialProviders} />}
        </VStack>
      )}
    </CostPanel>
  );
}

/**
 * The provider split, or the marker that says its read did not answer.
 *
 * Beside `Cost over time · by team` on purpose: the two are the same chart
 * over the same axis, one split by who spent and one by who billed, and
 * reading them as a pair is how a period that stood out gets attributed.
 *
 * In sample mode it stands down entirely, unlike the panels around it. There
 * is no invented provider series to draw — the sample set has agents, teams
 * and departments and no providers — and an empty panel sitting between two
 * full ones reads as a provider nobody used rather than as a gap in what was
 * invented.
 */
export function ProviderPanelSlot({
  organizationId,
  providerDays,
  hasFailure,
  interval,
  showSample,
}: {
  organizationId: string;
  providerDays: readonly GovernanceCostProviderDayRow[] | null;
  hasFailure: boolean;
  interval: TimeInterval;
  showSample: boolean;
}) {
  if (showSample) return null;
  if (hasFailure) {
    return (
      <CostPanel title="Cost over time · by provider">
        <CostPanelUnrefreshed />
      </CostPanel>
    );
  }
  if (providerDays === null || providerDays.length === 0) return null;
  return (
    <CostPanel title="Cost over time · by provider">
      <CostProviderDayPanel
        organizationId={organizationId}
        rows={providerDays}
        interval={interval}
      />
    </CostPanel>
  );
}
