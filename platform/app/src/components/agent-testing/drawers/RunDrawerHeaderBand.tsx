/**
 * The fixed band at the top of the run drawer: status, title, the version of
 * the case the run used, the actions, and the strip of chips under them.
 *
 * @see specs/features/agent-testing/side-by-side-run-drawer.feature
 * @see specs/scenarios/scenario-version-on-runs.feature
 */

import { Button, Heading, HStack, VStack } from "@chakra-ui/react";
import { Square } from "lucide-react";
import { formatCost, formatLatency } from "@langwatch/design-system/metric-value-formatters";
import {
  CopyIdChip,
  hasNoResults,
  RunCriteriaChip,
  SCENARIO_RUN_STATUS_CONFIG,
  ScenarioRunActions,
  ScenarioRunStatusIcon,
} from "@langwatch/scenario-web";
import { Drawer } from "~/components/ui/drawer";
import { Chip } from "~/features/traces-v2/components/TraceDrawer/Chip";
import { CaseVersionChip } from "../shared/CaseVersionChip";
import { useAgentTestingStore } from "../useAgentTestingStore";
import type {
  RunDetail,
  RunDrawerState,
  RunScenarioState,
  useRunDrawerStop,
} from "./useRunDrawerState";

export type RunDrawerHeaderBandProps = Pick<
  RunDrawerState,
  "detail" | "scenarioVersion"
> & { stop: ReturnType<typeof useRunDrawerStop> };

type SectionProps = {
  detail: RunDetail;
  scenarioState: RunScenarioState;
};

/**
 * The status, the name of the run, and the version of the case it ran.
 *
 * The version is a fact of this run, not a way into the history of the case:
 * the history belongs to the case, and the case dialog is where it reads.
 */
function HeadingRow({
  scenarioState,
  displayTitle,
  scenarioVersion,
}: {
  scenarioState: RunScenarioState;
  displayTitle: string;
  scenarioVersion: number | null;
}) {
  return (
    <HStack gap={3} flex={1} minWidth={0}>
      <ScenarioRunStatusIcon status={scenarioState.status} />
      <Heading size="md" truncate title={displayTitle}>
        {displayTitle}
      </Heading>
      {scenarioVersion != null && (
        <HStack data-testid="run-drawer-version">
          <CaseVersionChip version={scenarioVersion} />
        </HStack>
      )}
    </HStack>
  );
}

/** Everything the reader can do with the run from the band. */
function HeaderActions({
  detail,
  scenarioState,
  stop,
}: SectionProps & {
  stop: ReturnType<typeof useRunDrawerStop>;
}) {
  const { scenarioData } = detail;
  const openCaseEditor = useAgentTestingStore((state) => state.openCaseEditor);
  // Without a trace there is no conversation to reach, and a run that ends
  // before it answers has none worth opening.
  const isTraceReachable =
    !!detail.firstTraceId && !hasNoResults(scenarioState.status);

  const openThread = () =>
    detail.openDrawer("traceV2Details", {
      traceId: detail.firstTraceId!,
      mode: "conversation",
    });

  return (
    <HStack gap={1} flexShrink={0}>
      <ScenarioRunActions
        scenario={scenarioData}
        isRunning={detail.isRunning}
        onRunAgain={detail.handleRunAgainClick}
        onEditScenario={() =>
          scenarioData && openCaseEditor({ scenarioId: scenarioData.id })
        }
        onOpenThread={isTraceReachable ? openThread : null}
        onOpenInTraces={isTraceReachable ? detail.handleOpenInTraces : null}
        dejaViewHref={detail.dejaView.href ?? null}
      />
      {stop.canStop && (
        <Button
          size="xs"
          variant="outline"
          onClick={stop.handleStop}
          data-testid="run-drawer-stop"
        >
          <Square size={12} />
          Stop
        </Button>
      )}
      <Drawer.CloseTrigger />
    </HStack>
  );
}

/** The numbers of the run, each one only there once the run carries it. */
function ChipStrip({ detail, scenarioState }: SectionProps) {
  return (
    <HStack w="100%" gap={1.5} flexWrap="wrap">
      <Chip
        label="Status"
        value={SCENARIO_RUN_STATUS_CONFIG[scenarioState.status].label}
      />
      {scenarioState.results && !hasNoResults(scenarioState.status) && (
        <RunCriteriaChip
          metCriteria={scenarioState.results.metCriteria ?? []}
          unmetCriteria={scenarioState.results.unmetCriteria ?? []}
        />
      )}
      {scenarioState.durationInMs > 0 && (
        <Chip
          label="Duration"
          value={formatLatency(scenarioState.durationInMs)}
        />
      )}
      {scenarioState.totalCost != null && (
        <Chip label="Cost" value={formatCost(scenarioState.totalCost)} />
      )}
      {detail.timeAgo && <Chip label="Ran" value={detail.timeAgo} />}
      {detail.scenarioData?.archivedAt && (
        <Chip value="Archived" tone="yellow" />
      )}
      {detail.copyableIds?.map((id) => (
        <CopyIdChip key={id.label} label={id.label} value={id.value} />
      ))}
    </HStack>
  );
}

export function RunDrawerHeaderBand({
  detail,
  scenarioVersion,
  stop,
}: RunDrawerHeaderBandProps) {
  const { scenarioState } = detail;
  if (!scenarioState) return null;

  return (
    <VStack
      align="stretch"
      w="100%"
      gap={2}
      paddingX={4}
      paddingTop={3}
      paddingBottom={3}
      background="bg.panel/70"
      backdropFilter="blur(20px) saturate(150%)"
      borderTopRadius="lg"
      borderBottomWidth="1px"
      borderColor="border"
      flexShrink={0}
    >
      <HStack
        w="100%"
        justify="space-between"
        gap={2.5}
        minWidth={0}
        paddingEnd={8}
      >
        <HeadingRow
          scenarioState={scenarioState}
          displayTitle={detail.displayTitle}
          scenarioVersion={scenarioVersion}
        />
        <HeaderActions
          detail={detail}
          scenarioState={scenarioState}
          stop={stop}
        />
      </HStack>

      <ChipStrip detail={detail} scenarioState={scenarioState} />
    </VStack>
  );
}
