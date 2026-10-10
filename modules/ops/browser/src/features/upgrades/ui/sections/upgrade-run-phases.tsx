import { CodePreview } from "@langwatch/design-system/code-preview";
import { Box, Card, Heading, HStack, Stack, Text } from "@langwatch/design-system/primitives";
import { ResourceRow } from "@langwatch/design-system/resource-row";

import { formatDuration } from "../../../../model/ops-formatters.ts";
import {
  groupStepsByRelease,
  modeLabel,
  phaseLabel,
  phaseOutcomeLabel,
  runOutcomeLabel,
  statusTone,
} from "../../model/upgrade-labels.ts";
import type {
  UpgradeRunDetailView,
  UpgradeRunPhaseView,
  UpgradeStepView,
} from "../../model/upgrade-view.ts";
import { UpgradeStatusBadge } from "../elements/upgrade-status-badge.tsx";

function StepRow({ step }: { step: UpgradeStepView }) {
  return (
    <Box data-testid="upgrade-run-step">
      <ResourceRow
        name={step.id}
        status={
          <UpgradeStatusBadge
            label={{ label: step.statusLabel, tone: statusTone(step.status) }}
            size="sm"
          />
        }
        description={modeLabel(step.mode)}
        meta={step.startedAt ? formatDuration(step.startedAt, step.finishedAt) : void 0}
      />
    </Box>
  );
}

function PhaseRow({ phase }: { phase: UpgradeRunPhaseView }) {
  return (
    <HStack gap={3} wrap="wrap" data-testid="upgrade-run-phase">
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
      <HStack gap={3} wrap="wrap">
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
          <Card.Root
            key={group.release ?? "unreleased"}
            variant="outline"
            data-testid="upgrade-run-release"
          >
            <Card.Header>
              <Heading size="sm">{group.release ?? "Unreleased"}</Heading>
            </Card.Header>
            <Card.Body>
              <Stack gap={2}>
                {group.steps.map((step) => (
                  <StepRow key={step.id} step={step} />
                ))}
              </Stack>
            </Card.Body>
          </Card.Root>
        ))
      )}
      {run.plan !== null && (
        <Stack gap={2}>
          <Heading size="sm">Plan</Heading>
          <CodePreview
            code={JSON.stringify(run.plan, null, 2)}
            language="json"
            filename="Upgrade plan"
            lineNumbers
            compact
            maxHeight="480px"
          />
        </Stack>
      )}
      {run.report !== null && (
        <Stack gap={2}>
          <Heading size="sm">Report</Heading>
          <CodePreview
            code={JSON.stringify(run.report, null, 2)}
            language="json"
            filename="Run report"
            lineNumbers
            compact
            maxHeight="480px"
          />
        </Stack>
      )}
    </Stack>
  );
}
