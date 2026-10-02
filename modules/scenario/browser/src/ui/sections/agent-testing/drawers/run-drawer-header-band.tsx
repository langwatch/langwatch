/**
 * The fixed band at the top of the run drawer: status, title, the version of
 * the scenario the run used, the actions, and the strip of chips under them.
 * @see specs/features/agent-testing/side-by-side-run-drawer.feature
 * @see specs/scenarios/scenario-version-on-runs.feature
 */

import { Chip } from "@langwatch/design-system/chip";
import { formatCost, formatLatency } from "@langwatch/design-system/metric-value-formatters";
import { Button, Heading, HStack, VStack, Icon } from "@langwatch/design-system/primitives";
import { Drawer } from "@langwatch/design-system/studio-drawer";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { SimulationRunStatus } from "@langwatch/scenario-contract";
import { Square, Edit2, Play } from "lucide-react";
import { useState } from "react";

import { useCan } from "../../../../behavior/use-can.ts";
import { SCENARIO_RUN_STATUS_CONFIG } from "../../../../model/scenario-run-status-config.ts";
import { hasNoResults } from "../../../../model/scenario-run-status.utils.ts";
import { CaseVersionChip } from "../../../elements/agent-testing/shared/case-version-chip.tsx";
import { CopyIdChip } from "../../../elements/copy-id-chip.tsx";
import { CutAtLimitBadge, isCutAtLimitOf } from "../../../elements/cut-at-limit-badge.tsx";
import { RunCriteriaChip } from "../../../elements/run-criteria-chip.tsx";
import { ScenarioRunActions } from "../../../elements/scenario-run-actions.tsx";
import { ScenarioRunStatusIcon } from "../../../elements/scenario-run-status-icon.tsx";
import { CASE_EDITOR_DRAWER } from "../cases/drawer-keys.ts";
import { useRunStartedHandler } from "../cases/use-case-run-actions.ts";
import { RUN_AGAIN_LABEL } from "../results/run-plan-detail-header.tsx";
import {
  canRunAgain,
  RUN_AGAIN_FROM_CODE_REASON,
  runAgainSubjectOf,
} from "../results/use-run-plan-run-dialog.ts";
import { RunDialog, type RunDialogSubject } from "../run/run-dialog.tsx";
import type {
  RunDetail,
  RunDrawerState,
  RunScenarioState,
  useRunDrawerStop,
} from "./use-run-drawer-state.ts";
import { shouldShowWholeCallAudio, WholeCallAudio } from "./whole-call-audio.tsx";

export type RunDrawerHeaderBandProps = Pick<RunDrawerState, "detail" | "scenarioVersion"> & {
  stop: ReturnType<typeof useRunDrawerStop>;
};

type SectionProps = {
  detail: RunDetail;
  scenarioState: RunScenarioState;
};

/**
 * The status, the name of the run, and the version of the scenario it ran.
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
      {isCutAtLimitOf(scenarioState.metadata) && <CutAtLimitBadge />}
      {scenarioVersion != null && (
        <HStack data-testid="run-drawer-version">
          <CaseVersionChip version={scenarioVersion} />
        </HStack>
      )}
    </HStack>
  );
}

/** Why Run again is off for this run, or null when it is on. */
function runAgainDisabledReason({
  isFromCode,
  isArchived,
}: {
  isFromCode: boolean;
  isArchived: boolean;
}): string | null {
  if (isFromCode) return RUN_AGAIN_FROM_CODE_REASON;
  if (isArchived) return "This scenario has been archived and cannot be run";
  return null;
}

/**
 * Run again, through the same run dialog the results row opens. A run from
 * code, or of an archived scenario, offers it disabled and says why.
 */
function RunAgainAction({ detail, scenarioState }: SectionProps) {
  const [subject, setSubject] = useState<RunDialogSubject | null>(null);
  const onRunStarted = useRunStartedHandler();
  const isArchived = !!detail.scenarioData?.archivedAt;
  const disabledReason = runAgainDisabledReason({
    isFromCode: !canRunAgain({ scenarioRun: scenarioState }),
    isArchived,
  });

  const runAgain = () =>
    setSubject(
      runAgainSubjectOf({ scenarioRun: scenarioState, projectId: detail.project?.id ?? "" }),
    );

  return (
    <>
      <Tooltip content={disabledReason} disabled={!disabledReason}>
        {/* aria-disabled, not disabled: a disabled button never shows its tooltip. */}
        <Button
          size="xs"
          variant="outline"
          aria-disabled={!!disabledReason}
          opacity={disabledReason ? 0.5 : undefined}
          cursor={disabledReason ? "not-allowed" : undefined}
          onClick={disabledReason ? undefined : runAgain}
          data-testid="run-drawer-run-again"
        >
          <Icon as={Play} boxSize={3} />
          {RUN_AGAIN_LABEL}
        </Button>
      </Tooltip>
      {subject && (
        <RunDialog subject={subject} onClose={() => setSubject(null)} onRunStarted={onRunStarted} />
      )}
    </>
  );
}

/** Everything the reader can do with the run from the band, one size and variant. */
function HeaderActions({
  detail,
  scenarioState,
  stop,
}: SectionProps & {
  stop: ReturnType<typeof useRunDrawerStop>;
}) {
  const { scenarioData } = detail;
  const { can } = useCan();
  // Without a trace there is no conversation to reach, and a run that ends
  // before it answers has none worth opening.
  const isTraceReachable = !!detail.firstTraceId && !hasNoResults(scenarioState.status);

  const openThread = () =>
    detail.openDrawer("traceV2Details", {
      traceId: detail.firstTraceId!,
      mode: "conversation",
    });

  const openCaseEditor = () =>
    scenarioData &&
    detail.openDrawer(CASE_EDITOR_DRAWER, {
      scenarioId: scenarioData.id,
    });

  return (
    <HStack gap={1.5} flexShrink={0}>
      {scenarioData && (
        <Button
          size="xs"
          variant="outline"
          onClick={openCaseEditor}
          data-testid="run-drawer-open-scenario"
        >
          <Icon as={Edit2} boxSize={3} />
          Edit scenario
        </Button>
      )}
      {can("scenarios:manage") && <RunAgainAction detail={detail} scenarioState={scenarioState} />}
      {stop.canStop && (
        <Button size="xs" variant="outline" onClick={stop.handleStop} data-testid="run-drawer-stop">
          <Icon as={Square} boxSize={3} />
          Stop
        </Button>
      )}
      <ScenarioRunActions
        scenario={scenarioData}
        isRunning={detail.isRunning}
        onRunAgain={null}
        onEditScenario={null}
        onOpenThread={isTraceReachable ? openThread : null}
        onOpenInTraces={isTraceReachable ? detail.handleOpenInTraces : null}
        dejaViewHref={detail.dejaView.href ?? null}
      />
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
        value={SCENARIO_RUN_STATUS_CONFIG[scenarioState.status as SimulationRunStatus].label}
      />
      {scenarioState.results && !hasNoResults(scenarioState.status) && (
        <RunCriteriaChip
          metCriteria={scenarioState.results.metCriteria ?? []}
          unmetCriteria={scenarioState.results.unmetCriteria ?? []}
          inconclusiveCriteria={scenarioState.results.inconclusiveCriteria ?? []}
        />
      )}
      {scenarioState.durationInMs > 0 && (
        <Chip label="Duration" value={formatLatency(scenarioState.durationInMs)} />
      )}
      {scenarioState.totalCost != null && (
        <Chip label="Cost" value={formatCost(scenarioState.totalCost)} />
      )}
      {detail.timeAgo && <Chip label="Ran" value={detail.timeAgo} />}
      {detail.scenarioData?.archivedAt && <Chip value="Archived" tone="yellow" />}
      {detail.copyableIds?.map((id) => (
        <CopyIdChip key={id.label} label={id.label} value={id.value} />
      ))}
    </HStack>
  );
}

export function RunDrawerHeaderBand({ detail, scenarioVersion, stop }: RunDrawerHeaderBandProps) {
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
      <HStack w="100%" justify="space-between" gap={2.5} minWidth={0} paddingEnd={8}>
        <HeadingRow
          scenarioState={scenarioState}
          displayTitle={detail.displayTitle}
          scenarioVersion={scenarioVersion}
        />
        <HeaderActions detail={detail} scenarioState={scenarioState} stop={stop} />
      </HStack>

      <ChipStrip detail={detail} scenarioState={scenarioState} />

      {shouldShowWholeCallAudio({
        langwatch: scenarioState.metadata?.langwatch,
        scenarioRunId: scenarioState.scenarioRunId,
        projectId: detail.project?.id,
      }) && (
        <WholeCallAudio
          scenarioRunId={scenarioState.scenarioRunId}
          projectId={detail.project!.id}
        />
      )}
    </VStack>
  );
}
