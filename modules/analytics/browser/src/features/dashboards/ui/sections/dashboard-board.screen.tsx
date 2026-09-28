/**
 * One board: the Agent Flight Deck when the address names it, otherwise one
 * of the member's own. Only the frame and title render in this step; the
 * Flight Deck panels and the blank-board design arrive with their own steps.
 */

import { Badge, Box, Spacer, Text, VStack } from "@chakra-ui/react";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { UiPageLoading, UiPageNotFound } from "@langwatch/ui-kernel/page-fallbacks";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { useSavedDashboards } from "../../behavior/use-saved-dashboards.ts";
import { FLIGHT_DECK } from "../../model/boards.ts";
import { DashboardsGate } from "./dashboards-gate.tsx";

function BoardFrame({
  name,
  description,
  isDefault,
  areaLabel,
}: {
  name: string;
  description?: string;
  isDefault: boolean;
  areaLabel: string;
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
      </PageLayout.Header>
      <PageLayout.Container maxWidth="full" width="full">
        <VStack align="stretch" gap={4}>
          {description && <Text color="fg.muted">{description}</Text>}
          <Box as="section" aria-label={areaLabel} minHeight="240px" />
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

function Board() {
  const dashboardId = useAnalyticsHost().route().params.dashboardId;
  if (dashboardId === FLIGHT_DECK.id) {
    return (
      <BoardFrame
        name={FLIGHT_DECK.name}
        description={FLIGHT_DECK.description}
        isDefault={FLIGHT_DECK.isDefault}
        areaLabel="Panels"
      />
    );
  }
  return <SavedBoard dashboardId={dashboardId} />;
}

export default function DashboardBoardScreen() {
  return (
    <DashboardsGate>
      <Board />
    </DashboardsGate>
  );
}
