import { CodePreview } from "@langwatch/design-system/code-preview";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { InlineCode } from "@langwatch/design-system/inline-code";
import { ListTable } from "@langwatch/design-system/list-table";
import { Alert, Heading, HStack, Stack, Table, Text } from "@langwatch/design-system/primitives";
import { SummaryList, SummaryListItem } from "@langwatch/design-system/summary-list";

import { modeLabel, statusTone } from "../../model/upgrade-labels.ts";
import type { UpgradeStepDetailView, UpgradeTargetView } from "../../model/upgrade-view.ts";
import { UpgradeStatusBadge } from "../elements/upgrade-status-badge.tsx";

function TargetsTable({ targets }: { targets: readonly UpgradeTargetView[] }) {
  return (
    <ListTable density="compact" columnRules={false} containerProps={{ overflowX: "auto" }}>
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
      <HStack gap={2} wrap="wrap">
        <UpgradeStatusBadge
          label={{ label: step.statusLabel, tone: statusTone(step.status) }}
          size="md"
        />
        <Text textStyle="sm" color="fg.muted">
          {step.attempt === 1 ? "1 attempt" : `${step.attempt} attempts`}
        </Text>
      </HStack>
      {step.description && <Text textStyle="sm">{step.description}</Text>}
      <SummaryList>
        <SummaryListItem label="Step">
          <InlineCode>{step.id}</InlineCode>
        </SummaryListItem>
        <SummaryListItem label="Kind">{step.kind}</SummaryListItem>
        <SummaryListItem label="Mode">{modeLabel(step.mode)}</SummaryListItem>
        <SummaryListItem label="Release">{step.release ?? "Unreleased"}</SummaryListItem>
        {step.finishBy && <SummaryListItem label="Finish by">{step.finishBy}</SummaryListItem>}
        <SummaryListItem label="Owner">{step.owner ?? "Unattributed"}</SummaryListItem>
        <SummaryListItem label="Started">
          {step.startedAt ? <FormattedDate value={step.startedAt} /> : "Not yet"}
        </SummaryListItem>
        <SummaryListItem label="Finished">
          {step.finishedAt ? <FormattedDate value={step.finishedAt} /> : "Not yet"}
        </SummaryListItem>
      </SummaryList>
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
          <CodePreview
            code={JSON.stringify(step.report, null, 2)}
            language="json"
            filename="Checkpoint report"
            lineNumbers
            compact
            maxHeight="320px"
          />
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
