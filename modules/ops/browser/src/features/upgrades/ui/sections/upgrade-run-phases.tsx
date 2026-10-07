import { Heading, HStack, Stack, Status, Text } from "@langwatch/design-system/primitives";

import { formatDuration } from "../../../../model/ops-formatters.ts";
import { JsonViewer } from "../../../../ui/elements/ops-json-viewer.tsx";
import {
  groupStepsByRelease,
  modeLabel,
  phaseLabel,
  phaseOutcomeLabel,
  runOutcomeLabel,
  statusTone,
  tonePalette,
} from "../../model/upgrade-labels.ts";
import type {
  UpgradeRunDetailView,
  UpgradeRunPhaseView,
  UpgradeStepView,
} from "../../model/upgrade-view.ts";
import { UpgradeStatusBadge } from "../elements/upgrade-status-badge.tsx";

function StepRow({ step }: { step: UpgradeStepView }) {
  return (
    <HStack gap={3} data-testid="upgrade-run-step">
      <Status.Root colorPalette={tonePalette(statusTone(step.status))} size="sm">
        <Status.Indicator />
      </Status.Root>
      <Text textStyle="sm" fontFamily="mono" flex={1}>
        {step.id}
      </Text>
      <Text textStyle="xs" color="fg.muted">
        {modeLabel(step.mode)}
      </Text>
      <Text textStyle="xs" color="fg.muted">
        {step.statusLabel}
      </Text>
      <Text textStyle="xs" color="fg.muted" minWidth="64px" textAlign="end">
        {step.startedAt ? formatDuration(step.startedAt, step.finishedAt) : ""}
      </Text>
    </HStack>
  );
}

function PhaseRow({ phase }: { phase: UpgradeRunPhaseView }) {
  return (
    <HStack gap={3} data-testid="upgrade-run-phase">
      <Text textStyle="sm" flex={1}>
        {phaseLabel(phase.name)}
      </Text>
      <Text textStyle="xs" color="fg.muted" fontFamily="mono">
        {phase.release ?? ""}
      </Text>
      <UpgradeStatusBadge label={phaseOutcomeLabel(phase.outcome)} size="sm" />
      <Text textStyle="xs" color="fg.muted" minWidth="64px" textAlign="end">
        {formatDuration(phase.startedAt, phase.finishedAt)}
      </Text>
    </HStack>
  );
}

/** W4: a run's phases in the order they ran, its steps per release, then its plan and report. */
export function UpgradeRunPhases({ run }: { run: UpgradeRunDetailView }) {
  const releases = groupStepsByRelease(run.steps);
  return (
    <Stack gap={5}>
      <HStack gap={3}>
        <UpgradeStatusBadge label={runOutcomeLabel(run.outcome)} size="md" />
        <Text textStyle="sm" fontFamily="mono">
          {run.release ?? "Unreleased"}
        </Text>
        <Text textStyle="sm" color="fg.muted">
          {run.kind} · {formatDuration(run.startedAt, run.finishedAt)}
        </Text>
      </HStack>
      {run.phases.length > 0 && (
        <Stack gap={2} data-testid="upgrade-run-phases">
          <Heading size="sm">Phases</Heading>
          {run.phases.map((phase, index) => (
            <PhaseRow key={`${phase.name}:${phase.release ?? ""}:${index}`} phase={phase} />
          ))}
        </Stack>
      )}
      {releases.length === 0 ? (
        <Text color="fg.muted">The run recorded no step yet.</Text>
      ) : (
        releases.map((group) => (
          <Stack key={group.release ?? "unreleased"} gap={2} data-testid="upgrade-run-release">
            <Heading size="sm">{group.release ?? "Unreleased"}</Heading>
            {group.steps.map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
          </Stack>
        ))
      )}
      {run.plan !== null && (
        <Stack gap={2}>
          <Heading size="sm">Plan</Heading>
          <JsonViewer data={run.plan} maxHeight="480px" />
        </Stack>
      )}
      {run.report !== null && (
        <Stack gap={2}>
          <Heading size="sm">Report</Heading>
          <JsonViewer data={run.report} maxHeight="480px" />
        </Stack>
      )}
    </Stack>
  );
}
