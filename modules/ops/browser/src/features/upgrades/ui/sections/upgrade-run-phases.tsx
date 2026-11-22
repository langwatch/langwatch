import { Card } from "@langwatch/design-system/card";
import { CodePreview } from "@langwatch/design-system/code-preview";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import {
  Box,
  Button,
  Collapsible,
  HStack,
  Stack,
  Tabs,
  Text,
} from "@langwatch/design-system/primitives";
import { ResourceRow } from "@langwatch/design-system/resource-row";
import { SummaryList, SummaryListItem } from "@langwatch/design-system/summary-list";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import { formatDuration } from "../../../../model/ops-formatters.ts";
import {
  groupStepsByRelease,
  isImportedHistory,
  modeLabel,
  phaseLabel,
  phaseOutcomeLabel,
  releaseName,
  runKindLabel,
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

/** The phases in the order they ran. */
function RunPhases({ run }: { run: UpgradeRunDetailView }) {
  if (run.phases.length === 0) {
    return <Text color="fg.muted">The run recorded no phase.</Text>;
  }
  return (
    <Stack gap={2} data-testid="upgrade-run-phases">
      {run.phases.map((phase, index) => (
        <PhaseRow key={`${phase.name}:${phase.release ?? ""}:${index}`} phase={phase} />
      ))}
    </Stack>
  );
}

/** The run's steps under each release, in the reader's order. */
function RunSteps({ run }: { run: UpgradeRunDetailView }) {
  const releases = groupStepsByRelease(run.steps);
  if (releases.length === 0) return <Text color="fg.muted">The run recorded no step yet.</Text>;
  return (
    <Stack gap={4}>
      {releases.map((group) => (
        <Card
          key={group.release ?? "development"}
          title={releaseName(group.release)}
          titleLevel={3}
          padding="lg"
          data-testid="upgrade-run-release"
        >
          <Stack gap={2}>
            {group.steps.map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}

function RawJson({ title, value }: { title: string; value: Record<string, unknown> }) {
  return (
    <CodePreview
      code={JSON.stringify(value, null, 2)}
      language="json"
      filename={title}
      lineNumbers
      compact
      maxHeight="480px"
    />
  );
}

/** When and how the run ended, its steps' errors, and its raw plan and report behind Details. */
function RunLog({ run }: { run: UpgradeRunDetailView }) {
  const [showDetails, setShowDetails] = useState(false);
  const errors = run.steps.filter((step) => step.lastError !== null);
  return (
    <Stack gap={5} data-testid="upgrade-run-log">
      {isImportedHistory(run) ? (
        <Text textStyle="sm" data-testid="upgrade-run-imported">
          This run recorded the steps the installation had already applied before upgrade tracking
          began. Nothing ran.
        </Text>
      ) : (
        <SummaryList>
          <SummaryListItem label="Started">
            <FormattedDate value={run.startedAt} />
          </SummaryListItem>
          <SummaryListItem label="Finished">
            {run.finishedAt ? <FormattedDate value={run.finishedAt} /> : "Not yet"}
          </SummaryListItem>
          <SummaryListItem label="Errors">
            {errors.length === 0 ? "None recorded" : `${errors.length}`}
          </SummaryListItem>
        </SummaryList>
      )}
      {errors.map((step) => (
        <Stack key={step.id} gap={0}>
          <Text textStyle="xs" fontFamily="mono" color="fg.muted">
            {step.id}
          </Text>
          <Text textStyle="sm">{step.lastError}</Text>
        </Stack>
      ))}
      {(run.plan !== null || run.report !== null) && (
        <Collapsible.Root
          lazyMount
          open={showDetails}
          onOpenChange={(event) => setShowDetails(event.open)}
        >
          <Collapsible.Trigger asChild>
            <Button variant="ghost" size="sm" paddingX={1} data-testid="upgrade-run-details-toggle">
              {showDetails ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              Details
            </Button>
          </Collapsible.Trigger>
          <Collapsible.Content paddingTop={3}>
            <Stack gap={3} data-testid="upgrade-run-details">
              {run.plan !== null && <RawJson title="Upgrade plan" value={run.plan} />}
              {run.report !== null && <RawJson title="Run report" value={run.report} />}
            </Stack>
          </Collapsible.Content>
        </Collapsible.Root>
      )}
    </Stack>
  );
}

/** W4 as a drawer body: the run's outcome, then its Phases, Steps and Log. */
export function UpgradeRunDetail({ run }: { run: UpgradeRunDetailView }) {
  return (
    <Stack gap={5}>
      <HStack gap={3} wrap="wrap">
        <UpgradeStatusBadge label={runOutcomeLabel(run.outcome)} size="md" />
        {!isImportedHistory(run) && (
          <Text textStyle="sm" fontFamily="mono">
            {releaseName(run.release)}
          </Text>
        )}
        <Text textStyle="sm" color="fg.muted">
          {runKindLabel(run.kind)} · {formatDuration(run.startedAt, run.finishedAt)}
        </Text>
      </HStack>
      <Tabs.Root defaultValue="phases" variant="line" colorPalette="accent" lazyMount unmountOnExit>
        <Tabs.List marginBottom={4}>
          <Tabs.Trigger value="phases">Phases</Tabs.Trigger>
          <Tabs.Trigger value="steps">Steps</Tabs.Trigger>
          <Tabs.Trigger value="log">Log</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="phases" padding={0}>
          <RunPhases run={run} />
        </Tabs.Content>
        <Tabs.Content value="steps" padding={0}>
          <RunSteps run={run} />
        </Tabs.Content>
        <Tabs.Content value="log" padding={0}>
          <RunLog run={run} />
        </Tabs.Content>
      </Tabs.Root>
    </Stack>
  );
}
