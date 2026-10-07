import { ListTable } from "@langwatch/design-system/list-table";
import { Alert, Heading, HStack, Stack, Table, Text } from "@langwatch/design-system/primitives";

import { readableDate } from "../../../../model/ops-formatters.ts";
import { JsonViewer } from "../../../../ui/elements/ops-json-viewer.tsx";
import { modeLabel, statusTone } from "../../model/upgrade-labels.ts";
import type { UpgradeStepDetailView, UpgradeTargetView } from "../../model/upgrade-view.ts";
import { UpgradeStatusBadge } from "../elements/upgrade-status-badge.tsx";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <HStack gap={2} align="start">
      <Text textStyle="sm" color="fg.muted" minWidth="100px">
        {label}
      </Text>
      <Text textStyle="sm" fontFamily="mono" wordBreak="break-all">
        {value}
      </Text>
    </HStack>
  );
}

function moment(value: string | null): string {
  return value ? readableDate(value).toLocaleString() : "Not yet";
}

function TargetsTable({ targets }: { targets: readonly UpgradeTargetView[] }) {
  return (
    <ListTable>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Target</Table.ColumnHeader>
          <Table.ColumnHeader>Status</Table.ColumnHeader>
          <Table.ColumnHeader>Version</Table.ColumnHeader>
          <Table.ColumnHeader>Last error</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {targets.map((target) => (
          <Table.Row key={target.target}>
            <Table.Cell>{target.target}</Table.Cell>
            <Table.Cell>
              <UpgradeStatusBadge
                label={{ label: target.status, tone: statusTone(target.status) }}
              />
            </Table.Cell>
            <Table.Cell fontFamily="mono">{target.version ?? "None"}</Table.Cell>
            <Table.Cell>{target.lastError ?? ""}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </ListTable>
  );
}

/** W3, read-only: one step's facts, its last error, its report (the checkpoint) and targets. */
export function UpgradeStepDetail({ step }: { step: UpgradeStepDetailView }) {
  return (
    <Stack gap={5} data-testid="upgrade-step-detail">
      <HStack gap={2}>
        <UpgradeStatusBadge
          label={{ label: step.statusLabel, tone: statusTone(step.status) }}
          size="md"
        />
        <Text textStyle="sm" color="fg.muted">
          {step.attempt === 1 ? "1 attempt" : `${step.attempt} attempts`}
        </Text>
      </HStack>
      {step.description && <Text textStyle="sm">{step.description}</Text>}
      <Stack gap={1}>
        <Fact label="Step" value={step.id} />
        <Fact label="Kind" value={step.kind} />
        <Fact label="Mode" value={modeLabel(step.mode)} />
        <Fact label="Release" value={step.release ?? "Unreleased"} />
        <Fact label="Owner" value={step.owner ?? "Unattributed"} />
        <Fact label="Started" value={moment(step.startedAt)} />
        <Fact label="Finished" value={moment(step.finishedAt)} />
      </Stack>
      {step.lastError && (
        <Alert.Root status="error" data-testid="upgrade-step-error">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Last error</Alert.Title>
            <Alert.Description>{step.lastError}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}
      {step.report !== null && (
        <Stack gap={2}>
          <Heading size="xs">Checkpoint report</Heading>
          <JsonViewer data={step.report} maxHeight="320px" />
        </Stack>
      )}
      {step.targets.length > 0 && (
        <Stack gap={2}>
          <Heading size="xs">Targets</Heading>
          <TargetsTable targets={step.targets} />
        </Stack>
      )}
    </Stack>
  );
}
