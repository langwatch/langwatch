// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { HStack, Text, VStack } from "@chakra-ui/react";
import numeral from "numeral";

import { type Breakdowns } from "../../model/breakdowns.ts";
import { ADD_A_SOURCE } from "../../model/cost-panel-copy.ts";
import { sampleAdoption } from "../../model/sample-series.ts";
import { CostPanelEmpty } from "../elements/cost-panel-empty.tsx";
import { CostPanel } from "../elements/cost-panel.tsx";

export function AdoptionRow({
  breakdowns,
  showSample,
  sourcesConnected: connected,
}: {
  breakdowns: Breakdowns;
  showSample: boolean;
  sourcesConnected: boolean;
}) {
  const measured = breakdowns.activeUsers;
  const invented = showSample;

  return (
    <CostPanel title="Adoption" sample={invented}>
      <AdoptionFigures invented={invented} measured={measured} sourcesConnected={connected} />
    </CostPanel>
  );
}

/**
 * The adoption figures, invented or measured, in one shell.
 *
 * Sample mode chooses the DATA, never the panel: a sample-only panel that
 * happened to look like the real one is two components to keep in step, and
 * the day they drift the invented screen stops being a preview of anything.
 */
function AdoptionFigures({
  invented,
  measured,
  sourcesConnected: connected,
}: {
  invented: boolean;
  measured: number | null;
  sourcesConnected: boolean;
}) {
  if (invented) {
    const adoption = sampleAdoption();
    return (
      <HStack gap={10} align="flex-end" flexWrap="wrap">
        <Stat
          label="People using AI tools"
          value={numeral(adoption.peopleUsingAiTools).format("0,0")}
        />
        <Stat label="Active seats" value={numeral(adoption.activeSeats).format("0,0")} />
        <Stat label="Tools adopted" value={numeral(adoption.toolsAdopted).format("0,0")} />
        <Stat label="Change against previous period" value={`+${adoption.trendPct}%`} />
      </HStack>
    );
  }
  // Two ways to have no figure: the read never answered, or it answered with a
  // zero that no connected source stands behind. Both are unanswered in the
  // sense the panel cares about — nothing was measured — and both name the move
  // that would fill the card. See `sourcesConnected` for why the count itself
  // is never the test.
  if (measured === null || !connected) {
    return (
      <CostPanelEmpty
        unanswered
        height="72px"
        what="How many people used an AI tool in this period."
        source="Fills from the activity a connected source reports."
        action={ADD_A_SOURCE}
      />
    );
  }
  return (
    <HStack gap={10} align="flex-end">
      <Stat label="People using AI tools" value={numeral(measured).format("0,0")} />
    </HStack>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <VStack align="flex-start" gap={0}>
      <Text fontSize="xs" color="fg.muted">
        {label}
      </Text>
      <Text fontSize="2xl" fontWeight="semibold" lineHeight="1.1">
        {value}
      </Text>
    </VStack>
  );
}
