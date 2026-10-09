import { ListTable } from "@langwatch/design-system/list-table";
import {
  Badge,
  Button,
  Collapsible,
  Heading,
  HStack,
  Stack,
  Table,
  Text,
  Wrap,
} from "@langwatch/design-system/primitives";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import { formatDuration } from "../../../../model/ops-formatters.ts";
import {
  isFinished,
  modeLabel,
  statusTone,
  statusWords,
  tonePalette,
} from "../../model/upgrade-labels.ts";
import type { UpgradeStepView } from "../../model/upgrade-view.ts";
import { UpgradeErrorSummary } from "../elements/upgrade-error-summary.tsx";
import { UpgradeStatusBadge } from "../elements/upgrade-status-badge.tsx";
import { UpgradeStepState } from "../elements/upgrade-step-state.tsx";

/** How many steps fall under each value of one field, largest first. */
function countBy(steps: readonly UpgradeStepView[], field: "status" | "kind"): [string, number][] {
  const counts = new Map<string, number>();
  for (const step of steps) counts.set(step[field], (counts.get(step[field]) ?? 0) + 1);
  return [...counts].toSorted(([, left], [, right]) => right - left);
}

/** Done means it ran here, or another tool's record says it was applied before the ledger. */
function doneHow(step: UpgradeStepView): string {
  if (step.status === "not-needed") return "Not needed here";
  if (step.startedAt) return `Ran in ${formatDuration(step.startedAt, step.finishedAt)}`;
  return step.inferred ? "Recorded done before the ledger, not run" : "Recorded done, not run";
}

function StepSummary({ steps }: { steps: readonly UpgradeStepView[] }) {
  return (
    <Stack gap={2} data-testid="upgrade-steps-summary">
      <Wrap gap={2}>
        {countBy(steps, "status").map(([status, count]) => (
          <Badge
            key={status}
            size="md"
            variant="subtle"
            colorPalette={tonePalette(statusTone(status))}
          >
            {count} {statusWords(status)}
          </Badge>
        ))}
      </Wrap>
      <Text textStyle="sm" color="fg.muted">
        {countBy(steps, "kind")
          .map(([kind, count]) => `${count} ${kind}`)
          .join(" · ")}
      </Text>
    </Stack>
  );
}

function UnfinishedTable({
  steps,
  onOpenStep,
}: {
  steps: readonly UpgradeStepView[];
  onOpenStep: (stepId: string) => void;
}) {
  const show = {
    owner: steps.some((step) => step.owner !== null),
    attempts: steps.some((step) => step.attempt > 0),
    error: steps.some((step) => step.lastError !== null),
  };
  return (
    <ListTable data-testid="upgrade-steps-unfinished">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Step</Table.ColumnHeader>
          <Table.ColumnHeader>Mode</Table.ColumnHeader>
          <Table.ColumnHeader>Status</Table.ColumnHeader>
          {show.owner && <Table.ColumnHeader>Owner</Table.ColumnHeader>}
          {show.attempts && <Table.ColumnHeader textAlign="end">Attempts</Table.ColumnHeader>}
          {show.error && <Table.ColumnHeader>Last error</Table.ColumnHeader>}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {steps.map((step) => (
          <Table.Row
            key={step.id}
            cursor="pointer"
            onClick={() => onOpenStep(step.id)}
            data-testid={`upgrade-step-${step.id}`}
          >
            <Table.Cell verticalAlign="top">
              <Text textStyle="sm" fontFamily="mono" whiteSpace="nowrap">
                {step.id}
              </Text>
              <Text textStyle="xs" color="fg.muted" whiteSpace="nowrap">
                {step.kind}
              </Text>
            </Table.Cell>
            <Table.Cell verticalAlign="top">{modeLabel(step.mode)}</Table.Cell>
            <Table.Cell verticalAlign="top">
              <UpgradeStepState step={step} />
            </Table.Cell>
            {show.owner && <Table.Cell verticalAlign="top">{step.owner}</Table.Cell>}
            {show.attempts && (
              <Table.Cell verticalAlign="top" textAlign="end">
                {step.attempt > 0 ? step.attempt : null}
              </Table.Cell>
            )}
            {show.error && (
              <Table.Cell verticalAlign="top" maxWidth="420px">
                {step.lastError && <UpgradeErrorSummary error={step.lastError} />}
              </Table.Cell>
            )}
          </Table.Row>
        ))}
      </Table.Body>
    </ListTable>
  );
}

function FinishedTable({
  steps,
  onOpenStep,
}: {
  steps: readonly UpgradeStepView[];
  onOpenStep: (stepId: string) => void;
}) {
  const showOwner = steps.some((step) => step.owner !== null);
  return (
    <ListTable size="sm" data-testid="upgrade-steps-finished">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Step</Table.ColumnHeader>
          <Table.ColumnHeader>Kind</Table.ColumnHeader>
          <Table.ColumnHeader>Mode</Table.ColumnHeader>
          <Table.ColumnHeader>Status</Table.ColumnHeader>
          {showOwner && <Table.ColumnHeader>Owner</Table.ColumnHeader>}
          <Table.ColumnHeader>How</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {steps.map((step) => (
          <Table.Row
            key={step.id}
            cursor="pointer"
            onClick={() => onOpenStep(step.id)}
            data-testid={`upgrade-step-${step.id}`}
          >
            <Table.Cell fontFamily="mono" whiteSpace="nowrap">
              {step.id}
            </Table.Cell>
            <Table.Cell whiteSpace="nowrap">{step.kind}</Table.Cell>
            <Table.Cell>{modeLabel(step.mode)}</Table.Cell>
            <Table.Cell>
              <UpgradeStatusBadge
                label={{ label: step.statusLabel, tone: statusTone(step.status) }}
              />
            </Table.Cell>
            {showOwner && <Table.Cell>{step.owner}</Table.Cell>}
            <Table.Cell color="fg.muted">{doneHow(step)}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </ListTable>
  );
}

/** W2: a summary, the steps still to do with what they wait on, and the finished ones collapsed. */
export function UpgradeReleaseSteps({
  release,
  steps,
  onOpenStep,
}: {
  release: string | null;
  steps: readonly UpgradeStepView[];
  onOpenStep: (stepId: string) => void;
}) {
  const [showApplied, setShowApplied] = useState(false);
  if (steps.length === 0) {
    return (
      <Text color="fg.muted">
        {release ? `Release ${release} declared no steps.` : "No unreleased steps."}
      </Text>
    );
  }
  const unfinished = steps.filter((step) => !isFinished(step.status));
  const finished = steps.filter((step) => isFinished(step.status));
  return (
    <Stack gap={8}>
      <StepSummary steps={steps} />
      <Stack gap={3}>
        <Heading size="sm">Still to do ({unfinished.length})</Heading>
        {unfinished.length > 0 ? (
          <UnfinishedTable steps={unfinished} onOpenStep={onOpenStep} />
        ) : (
          <Text textStyle="sm" color="fg.muted">
            Every step is applied.
          </Text>
        )}
      </Stack>
      {finished.length > 0 && (
        <Collapsible.Root
          lazyMount
          open={showApplied}
          onOpenChange={(event) => setShowApplied(event.open)}
        >
          <Collapsible.Trigger asChild>
            <Button variant="ghost" size="sm" paddingX={1}>
              <HStack gap={2}>
                {showApplied ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <Heading size="sm">Applied ({finished.length})</Heading>
              </HStack>
            </Button>
          </Collapsible.Trigger>
          <Collapsible.Content paddingTop={3}>
            <FinishedTable steps={finished} onOpenStep={onOpenStep} />
          </Collapsible.Content>
        </Collapsible.Root>
      )}
    </Stack>
  );
}
