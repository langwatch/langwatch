import { Card, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import { useMemo } from "react";
import { AnomaliesCard } from "~/components/ops/queues/AnomaliesCard";
import { LanesCard } from "~/components/ops/queues/LanesCard";
import { ParkedLanesCard } from "~/components/ops/queues/ParkedLanesCard";
import type { DashboardData } from "~/server/app-layer/ops/types";
import { ActiveOperationsSection } from "./ActiveOperationsSection";
import { buildDashboardTiles } from "./dashboardTiles";
import { LaneDepthChart } from "./LaneDepthChart";
import { LinkedStat } from "./LinkedStat";
import { RedisStatTiles } from "./RedisStatTiles";
import { ReplayHistorySection } from "./ReplayHistorySection";

/**
 * The ops dashboard, over the dispatch plane's lane vocabulary (ADR-108).
 *
 * Every figure below is read from a lane key or from the collector's own
 * process sampling. Throughput, latency and dead-letter tiles used to sit in
 * this grid; the substrate for all three went with the old plane, and rates
 * leave the new one through a scraped `Metrics` port that has no read seam.
 * They are absent rather than zeroed — a zero here is a number an operator
 * would trust during the incident this page exists for.
 */
export function OpsDashboardContent({ data }: { data: DashboardData }) {
  const tiles = useMemo(() => buildDashboardTiles(data), [data]);

  return (
    <VStack align="stretch" gap={5} width="full">
      <ActiveOperationsSection />

      <SimpleGrid columns={{ base: 2, md: 5, lg: 9 }} gap={1}>
        {tiles.map((tile) => (
          <LinkedStat
            key={tile.source}
            label={tile.label}
            value={tile.value}
            sublabel={tile.sublabel}
            color={tile.color}
            testId={tile.testId}
          />
        ))}
        <RedisStatTiles data={data} />
      </SimpleGrid>

      <Card.Root overflow="hidden">
        <Card.Body padding={4}>
          <Text
            textStyle="xs"
            fontWeight="medium"
            color="fg.muted"
            marginBottom={2}
          >
            Lane depth
          </Text>
          <LaneDepthChart data={data} />
        </Card.Body>
      </Card.Root>

      <ParkedLanesCard
        clusters={data.topParkReasons}
        totalParked={data.parkedLanes}
      />

      <AnomaliesCard />
      <LanesCard laneKinds={data.laneKinds} />

      <ReplayHistorySection />
    </VStack>
  );
}
