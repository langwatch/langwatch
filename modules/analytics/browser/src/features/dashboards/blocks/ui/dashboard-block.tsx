/**
 * One block as a card, and the Agent Flight Deck as ten of them. States:
 * loading, data, empty, error with its own retry, or the source's call to
 * action; an unconnected source sends no block query (AC22).
 */

import {
  Box,
  Button,
  Card,
  GridItem,
  HStack,
  SimpleGrid,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  Bot,
  FlaskConical,
  Gauge,
  type LucideIcon,
  ListChecks,
  ListTree,
  MessageSquare,
  RefreshCw,
  Route,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { HandledErrorAlert } from "../../../../ui/elements/handled-error-alert.tsx";
import { useBlockData, useSourceConnection } from "../behavior/use-block-data.ts";
import {
  type BlockDefinition,
  type BlockSource,
  type BlockView,
  blockState,
  SOURCE_CALLS_TO_ACTION,
} from "../model/block-definition.ts";
import { blockHasData, type BlockPeriod } from "../model/block-format.ts";
import { FLIGHT_DECK_BLOCKS, findBlock } from "../model/block-registry.ts";
import {
  type ChartViewProps,
  FeedbackView,
  LineView,
  QualityView,
  RankingView,
  ThroughputView,
} from "./block-charts.tsx";
import {
  CodingAgentsView,
  CostEfficiencyView,
  FailuresView,
  GatewayView,
  ImpactfulTracesView,
  ScenariosView,
  StatusView,
} from "./block-tables.tsx";

const VIEWS: Readonly<Record<BlockView, ComponentType<ChartViewProps>>> = {
  line: LineView,
  ranking: RankingView,
  status: StatusView,
  throughput: ThroughputView,
  costEfficiency: CostEfficiencyView,
  failures: FailuresView,
  scenarios: ScenariosView,
  quality: QualityView,
  feedback: FeedbackView,
  gateway: GatewayView,
  codingAgents: CodingAgentsView,
  impactfulTraces: ImpactfulTracesView,
};

const SOURCE_ICONS: Readonly<Record<BlockSource, LucideIcon>> = {
  traces: ListTree,
  scenarios: ListChecks,
  judges: FlaskConical,
  feedback: MessageSquare,
  gateway: Route,
  codingAgents: Bot,
};

const VIEW_ICONS: Partial<Readonly<Record<BlockView, LucideIcon>>> = {
  status: Gauge,
  costEfficiency: Gauge,
};

/** Card chrome every block wears, so a board reads as one surface. */
function BlockCard({ block, children }: { block: BlockDefinition; children: ReactNode }) {
  const Icon = VIEW_ICONS[block.view] ?? SOURCE_ICONS[block.source];
  return (
    <Card.Root height="full" data-testid={`dashboard-block-${block.id}`}>
      <Card.Header paddingBottom={2}>
        <HStack gap={1.5}>
          <Box color="teal.fg">
            <Icon size={15} aria-hidden />
          </Box>
          <Text fontWeight="medium">{block.title}</Text>
        </HStack>
        <Text fontSize="13px" color="fg.muted">
          {block.subtitle}
        </Text>
      </Card.Header>
      <Card.Body paddingTop={2}>{children}</Card.Body>
    </Card.Root>
  );
}

/**
 * The discovery state: what the block would show once its source is wired,
 * and a button to the page that wires it.
 */
export function NotConnected({
  icon: Icon,
  title,
  line,
  button,
  onAction,
}: {
  icon: LucideIcon;
  title: string;
  line: string;
  button: string;
  onAction: () => void;
}) {
  return (
    <VStack
      gap={2}
      borderWidth="1px"
      borderStyle="dashed"
      borderRadius="lg"
      background="bg.subtle"
      paddingX={5}
      paddingY={8}
      textAlign="center"
      data-testid="block-not-connected"
    >
      <Box borderRadius="lg" background="bg.muted" padding={2} color="teal.fg">
        <Icon size={18} strokeWidth={1.8} aria-hidden />
      </Box>
      <Text fontWeight="semibold">{title}</Text>
      <Text fontSize="13px" color="fg.muted" maxWidth="sm">
        {line}
      </Text>
      <Button size="sm" colorPalette="teal" onClick={onAction}>
        {button}
      </Button>
    </VStack>
  );
}

function SourceCallToAction({ source }: { source: BlockSource }) {
  const host = useAnalyticsHost();
  const cta = SOURCE_CALLS_TO_ACTION[source];
  const slug = host.project()?.slug ?? "";
  return (
    <NotConnected
      icon={SOURCE_ICONS[source]}
      title={cta.title}
      line={cta.line}
      button={cta.button}
      onAction={() => host.navigate(cta.target(slug))}
    />
  );
}

function BlockError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <VStack align="stretch" gap={2} data-testid="block-error">
      <HandledErrorAlert
        error={error ?? "unknown"}
        fallbackTitle="This block could not load its data"
      />
      <HStack>
        <Button size="xs" variant="outline" onClick={onRetry}>
          <RefreshCw size={12} />
          Retry
        </Button>
      </HStack>
    </VStack>
  );
}

function BlockPlaceholder({ children }: { children: ReactNode }) {
  return (
    <HStack justify="center" gap={2} minHeight="120px" color="fg.muted" fontSize="13px">
      {children}
    </HStack>
  );
}

export interface DashboardBlockProps extends BlockPeriod {
  readonly blockId: string;
  readonly projectId: string;
}

/** One registered block, fetched and drawn on its own. */
export function DashboardBlock({ blockId, projectId, ...period }: DashboardBlockProps) {
  const block = findBlock(blockId);
  if (!block) return null;
  return <RegisteredBlock block={block} projectId={projectId} period={period} />;
}

function RegisteredBlock({
  block,
  projectId,
  period,
}: {
  block: BlockDefinition;
  projectId: string;
  period: BlockPeriod;
}) {
  const source = useSourceConnection({ projectId, source: block.source });
  const data = useBlockData({ projectId, block, period, enabled: source.connected });
  const state = blockState({
    sourceStatus: source.status,
    connected: source.connected,
    dataStatus: data.status,
    hasRows: data.rows ? blockHasData({ view: block.view, rows: data.rows }) : false,
  });
  const View = VIEWS[block.view];

  return (
    <BlockCard block={block}>
      {state === "loading" && (
        <BlockPlaceholder>
          <Spinner size="sm" />
          Loading
        </BlockPlaceholder>
      )}
      {state === "notConnected" && <SourceCallToAction source={block.source} />}
      {state === "error" &&
        (source.status === "error" ? (
          <BlockError error={source.error} onRetry={source.retry} />
        ) : (
          <BlockError error={data.error} onRetry={data.retry} />
        ))}
      {state === "empty" && <BlockPlaceholder>No data yet</BlockPlaceholder>}
      {state === "data" && data.rows && (
        <View
          rows={data.rows}
          unit={block.unit ?? "count"}
          granularitySeconds={data.granularitySeconds}
        />
      )}
    </BlockCard>
  );
}

export interface FlightDeckPanelsProps extends BlockPeriod {
  readonly projectId: string;
}

/** The ten Agent Flight Deck panels: full-width ones span the row, the rest sit two per row. */
export function FlightDeckPanels({ projectId, ...period }: FlightDeckPanelsProps) {
  return (
    <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4} width="full">
      {FLIGHT_DECK_BLOCKS.map((block) => (
        <GridItem key={block.id} colSpan={block.width === "full" ? { base: 1, lg: 2 } : 1}>
          <RegisteredBlock block={block} projectId={projectId} period={period} />
        </GridItem>
      ))}
    </SimpleGrid>
  );
}
