/**
 * One board: the Agent Flight Deck when the address names it, with its
 * panels and period control, otherwise one of the member's own (blocks
 * arrive with their own step; an empty one keeps the blank area).
 */

import { Badge, Box, Spacer, Text, VStack } from "@chakra-ui/react";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { nowInstant } from "@langwatch/time";
import { UiPageLoading, UiPageNotFound } from "@langwatch/ui-kernel/page-fallbacks";
import { useMemo, type ReactNode } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { useSavedDashboards } from "../../behavior/use-saved-dashboards.ts";
import { FlightDeckPanels } from "../../blocks/index.ts";
import {
  boardPeriodBounds,
  boardPeriodGranularity,
  parseBoardPeriodGrain,
  parseBoardPeriodRange,
} from "../../model/board-period.ts";
import { FLIGHT_DECK } from "../../model/boards.ts";
import { BoardPeriodControl } from "../blocks/board-period-control.tsx";
import { DashboardsGate } from "./dashboards-gate.tsx";

function BoardFrame({
  name,
  description,
  isDefault,
  areaLabel,
  periodControl,
  children,
}: {
  name: string;
  description?: string;
  isDefault: boolean;
  areaLabel: string;
  periodControl?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <VStack align="stretch" gap={0} width="full">
      <PageLayout.Header>
        <PageLayout.Heading>{name}</PageLayout.Heading>
        {isDefault && (
          <Badge size="sm" variant="subtle" textTransform="uppercase">
            Default
          </Badge>
        )}
        <Spacer />
        {periodControl}
      </PageLayout.Header>
      <PageLayout.Container maxWidth="full" width="full">
        <VStack align="stretch" gap={4}>
          {description && <Text color="fg.muted">{description}</Text>}
          <Box as="section" aria-label={areaLabel} minHeight="240px">
            {children}
          </Box>
        </VStack>
      </PageLayout.Container>
    </VStack>
  );
}

function SavedBoard({ dashboardId }: { dashboardId: string | undefined }) {
  const { boards, isLoading } = useSavedDashboards();
  if (isLoading) return <UiPageLoading />;
  const board = boards.find(({ id }) => id === dashboardId);
  if (!board) return <UiPageNotFound />;
  return <BoardFrame name={board.name} isDefault={false} areaLabel="Blocks" />;
}

function FlightDeckBoard() {
  const host = useAnalyticsHost();
  const projectId = host.project()?.id;
  const query = host.route().query;
  const range = parseBoardPeriodRange(query.range);
  const grain = parseBoardPeriodGrain(query.grain);

  // Fixed once per range change, not every render, so panels don't refetch on each rerender.
  const { periodStart, periodEnd } = useMemo(
    () => boardPeriodBounds({ range, now: nowInstant().epochMilliseconds }),
    [range],
  );
  const granularitySeconds = useMemo(
    () => boardPeriodGranularity({ grain, periodStart, periodEnd }),
    [grain, periodStart, periodEnd],
  );

  return (
    <BoardFrame
      name={FLIGHT_DECK.name}
      description={FLIGHT_DECK.description}
      isDefault={FLIGHT_DECK.isDefault}
      areaLabel="Panels"
      periodControl={
        <BoardPeriodControl
          range={range}
          grain={grain}
          onRangeChange={(next) => host.setQuery({ ...query, range: next })}
          onGrainChange={(next) => host.setQuery({ ...query, grain: next })}
        />
      }
    >
      {projectId && (
        <FlightDeckPanels
          projectId={projectId}
          periodStart={periodStart}
          periodEnd={periodEnd}
          granularitySeconds={granularitySeconds}
        />
      )}
    </BoardFrame>
  );
}

function Board() {
  const dashboardId = useAnalyticsHost().route().params.dashboardId;
  if (dashboardId === FLIGHT_DECK.id) return <FlightDeckBoard />;
  return <SavedBoard dashboardId={dashboardId} />;
}

export default function DashboardBoardScreen() {
  return (
    <DashboardsGate>
      <Board />
    </DashboardsGate>
  );
}
