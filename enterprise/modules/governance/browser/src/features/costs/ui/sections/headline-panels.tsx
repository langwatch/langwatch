// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { SimpleGrid } from "@chakra-ui/react";

import { type SampleSeries } from "../../behavior/use-sample-series.ts";
import { fmtWhole } from "../../model/cost-figure-format.ts";
import {
  AGENTS_ARE_UNATTRIBUTED,
  ADD_A_SOURCE,
  AWAITING_A_READ,
  SEAT_SERIES_COLORS,
} from "../../model/cost-panel-copy.ts";
import { type RankRow } from "../../model/sample-series.ts";
import { type TimeInterval } from "../../model/time-controls.ts";
import { CostForecastArea } from "../blocks/cost-forecast-area.tsx";
import { CostRankList } from "../blocks/cost-rank-list.tsx";
import { CostStackedBars } from "../blocks/cost-stacked-bars.tsx";
import { costPanelEmpty } from "../elements/cost-panel-empty.tsx";
import { CostPanel } from "../elements/cost-panel.tsx";
import { CostPanelUnrefreshed } from "./costs-notices.tsx";

/**
 * The two wide panels that only exist in sample mode.
 *
 * Both illustrate a measurement the platform does not take yet, so neither has
 * a real counterpart to stand aside for — they are simply absent when sample
 * mode is off, rather than rendering empty.
 */
export function HeadlinePanels({
  sample,
  interval,
  showSample,
}: {
  sample: SampleSeries;
  interval: TimeInterval;
  showSample: boolean;
}) {
  return (
    <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4}>
      {/*
        "Metered spend", not "consumption": the gateway lane above is labelled
        "Metered by gateway" and ADR-128 §2 calls this money gateway metering
        throughout. A screen that names the same money two ways teaches the
        reader they are two things.
      */}
      <CostPanel title="Metered spend forecast · by agent" sample={showSample}>
        <CostForecastArea
          buckets={showSample ? sample.forecast.buckets : AWAITING_A_READ}
          projectedFromDay={showSample ? sample.forecast.projectedFromDay : null}
          interval={interval}
          empty={costPanelEmpty({
            what: "Where metered spend per agent is heading, period by period.",
            ...AGENTS_ARE_UNATTRIBUTED,
          })}
        />
      </CostPanel>
      {/*
        Seats are COUNTS (ADR-128 §6, and §16's wave-1 aggregate: "you pay for
        N seats, M are assigned"). This panel used to draw them as daily
        dollars, which is wrong twice over — nobody is charged for a
        subscription daily, and §6's reversal note says seat money is not
        something this product holds at all. Bought and assigned are drawn side
        by side rather than stacked; the gap between them is the idle seats the
        panel exists to show.

        Per licence pool rather than per department: the wave-1 seat read is
        the provider's own SKU/roster count, and per-person assignment facts —
        the only thing that could attribute a seat to a department — are named
        in §16 as wave 2.
      */}
      <CostPanel title="Seats · bought against assigned" sample={showSample}>
        {/* Whole numbers, like the conversations panel: a seat is a thing
            somebody was given, and "1.2k seats" is not how a licence count is
            ever discussed.

            Explicit colours because the two series are the panel: bought and
            assigned hashed to two blues that had to be told apart by reading
            the legend, on the one chart whose whole content is the gap between
            them. Bought is the outline of what is paid for and assigned is
            what is used, so the used half carries the stronger colour. */}
        <CostStackedBars
          buckets={showSample ? sample.seats : AWAITING_A_READ}
          format={fmtWhole}
          interval={interval}
          colorFor={(key) => SEAT_SERIES_COLORS[key]}
          grouped
          empty={costPanelEmpty({
            what: "Seats bought against seats assigned, period by period.",
            source: "Fills once seat licences are collected from a source.",
            action: ADD_A_SOURCE,
          })}
        />
      </CostPanel>
    </SimpleGrid>
  );
}

/**
 * Spend per person as the gateway measured it.
 *
 * "Metered", not "Cost", because the panel beside it also ranks people by
 * money and the two figures are different money — this one is what the
 * traffic measured as it was served, that one is what the provider put on the
 * invoice. They disagree routinely, so each title has to name its lane or the
 * pair reads as the same list rendered twice.
 */
export function MeteredPersonPanel({
  rows,
  sample,
  showSample,
  unrefreshed,
}: {
  rows: RankRow[] | null;
  sample: SampleSeries;
  showSample: boolean;
  unrefreshed: boolean;
}) {
  return (
    <CostPanel title="Metered spend by person" sample={showSample}>
      {unrefreshed ? (
        <CostPanelUnrefreshed />
      ) : (
        <CostRankList
          rows={showSample ? sample.users : rows}
          empty={costPanelEmpty({
            what: "Spend recorded against each person as their traffic was served.",
            source: "Fills from gateway traffic and from usage rows that name an actor.",
            action: ADD_A_SOURCE,
          })}
        />
      )}
    </CostPanel>
  );
}
