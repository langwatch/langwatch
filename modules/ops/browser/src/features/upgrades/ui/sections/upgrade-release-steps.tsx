import { ListTable } from "@langwatch/design-system/list-table";
import { OverflownTextWithTooltip } from "@langwatch/design-system/overflown-text";
import { Heading, Stack, Table, Text } from "@langwatch/design-system/primitives";

import { formatDuration } from "../../../../model/ops-formatters.ts";
import { groupStepsByMode, statusTone } from "../../model/upgrade-labels.ts";
import type { UpgradeStepView } from "../../model/upgrade-view.ts";
import { UpgradeStatusBadge } from "../elements/upgrade-status-badge.tsx";

function StepsTable({
  steps,
  onOpenStep,
}: {
  steps: readonly UpgradeStepView[];
  onOpenStep: (stepId: string) => void;
}) {
  return (
    <ListTable>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Step</Table.ColumnHeader>
          <Table.ColumnHeader>Owner</Table.ColumnHeader>
          <Table.ColumnHeader>Kind</Table.ColumnHeader>
          <Table.ColumnHeader>Status</Table.ColumnHeader>
          <Table.ColumnHeader>Attempts</Table.ColumnHeader>
          <Table.ColumnHeader>Duration</Table.ColumnHeader>
          <Table.ColumnHeader>Last error</Table.ColumnHeader>
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
            <Table.Cell fontFamily="mono">{step.id}</Table.Cell>
            <Table.Cell>{step.owner ?? "Unattributed"}</Table.Cell>
            <Table.Cell>{step.kind}</Table.Cell>
            <Table.Cell>
              <UpgradeStatusBadge
                label={{ label: step.statusLabel, tone: statusTone(step.status) }}
              />
            </Table.Cell>
            <Table.Cell>{step.attempt}</Table.Cell>
            <Table.Cell>
              {step.startedAt ? formatDuration(step.startedAt, step.finishedAt) : "Not started"}
            </Table.Cell>
            <Table.Cell maxWidth="320px">
              {step.lastError ? (
                <OverflownTextWithTooltip>{step.lastError}</OverflownTextWithTooltip>
              ) : null}
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </ListTable>
  );
}

/** W2: one release's steps, grouped Blocking, Background, Operator. */
export function UpgradeReleaseSteps({
  release,
  steps,
  onOpenStep,
}: {
  release: string | null;
  steps: readonly UpgradeStepView[];
  onOpenStep: (stepId: string) => void;
}) {
  const groups = groupStepsByMode(steps);
  if (groups.length === 0) {
    return (
      <Text color="fg.muted">
        {release ? `Release ${release} declared no steps.` : "No unreleased steps."}
      </Text>
    );
  }
  return (
    <Stack gap={6}>
      {groups.map((group) => (
        <Stack key={group.mode} gap={3} data-testid={`upgrade-mode-${group.mode}`}>
          <Heading size="sm">{group.label}</Heading>
          <StepsTable steps={group.steps} onOpenStep={onOpenStep} />
        </Stack>
      ))}
    </Stack>
  );
}
