import { CopyButton } from "@langwatch/design-system/copy-button";
import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import {
  Alert,
  Badge,
  Button,
  Code,
  Heading,
  HStack,
  Skeleton,
  Stack,
  Table,
  Text,
  Wrap,
} from "@langwatch/design-system/primitives";
import { StatTile, StatTileFigure, StatTileGrid } from "@langwatch/design-system/stat-tile";
import { readableDate } from "@langwatch/time";
import { DatabaseZap } from "lucide-react";
import type { ReactNode } from "react";

import { formatDuration } from "../../../../model/ops-formatters.ts";
import {
  runOutcomeLabel,
  statusTone,
  tonePalette,
  toneOf,
  upgradeCommandFor,
} from "../../model/upgrade-labels.ts";
import type {
  UpgradeReleaseView,
  UpgradeRunSummaryView,
  UpgradeStatusView,
  UpgradeStepView,
} from "../../model/upgrade-view.ts";
import { UpgradeStatusBadge } from "../elements/upgrade-status-badge.tsx";

/** The address segment of steps the image declares under no release. */
export const UNRELEASED = "unreleased";

export type UpgradesOverviewProps = {
  status: UpgradeStatusView;
  releases: readonly UpgradeReleaseView[];
  runs: readonly UpgradeRunSummaryView[];
  failedSteps: readonly UpgradeStepView[];
  /** Background steps not yet done, from `listSteps({ mode: "background" })`. */
  backgroundSteps?: readonly UpgradeStepView[];
  /** The background read is still loading: the list shows a skeleton. */
  backgroundLoading?: boolean;
  /** Given only to an `ops:manage` reader: a failed background step then offers Retry. */
  onRetryStep?: (stepId: string) => void;
  retryingStepId?: string | null;
  /** The eventing upcaster's "active upcasts" reading, mounted by the screen once it exists. */
  activeUpcasts?: ReactNode;
  onOpenRelease: (release: string) => void;
  onOpenRun: (runId: string) => void;
  onOpenStep: (stepId: string) => void;
};

function StateHeadline({ status }: { status: UpgradeStatusView }) {
  const command = upgradeCommandFor({ reason: status.reason });
  return (
    <Stack gap={2} data-testid="upgrade-installation-state">
      <HStack gap={2}>
        <UpgradeStatusBadge label={{ label: status.label, tone: toneOf(status.tone) }} size="lg" />
        {status.installed && <CopyButton value={status.installed} label="Copy installed release" />}
      </HStack>
      <Text textStyle="sm">{status.summary}</Text>
      {command && (
        <HStack gap={2}>
          <Code>{command}</Code>
          <CopyButton value={command} label="Copy command" />
        </HStack>
      )}
    </Stack>
  );
}

function ReleaseStrip({ status }: { status: UpgradeStatusView }) {
  const lastRun = status.lastRun;
  return (
    <StatTileGrid columns={4}>
      <StatTile label="Installed" data-testid="upgrade-installed">
        <StatTileFigure>{status.installed ?? "None recorded"}</StatTileFigure>
      </StatTile>
      <StatTile label="Image" data-testid="upgrade-image">
        <StatTileFigure>{status.image}</StatTileFigure>
      </StatTile>
      <StatTile label="LTS floor" data-testid="upgrade-floor">
        <StatTileFigure>{status.floor ?? "Not named"}</StatTileFigure>
      </StatTile>
      <StatTile
        label="Last run"
        hint={lastRun ? formatDuration(lastRun.startedAt, lastRun.finishedAt) : void 0}
        data-testid="upgrade-last-run"
      >
        {lastRun ? (
          <UpgradeStatusBadge label={runOutcomeLabel(lastRun.outcome)} />
        ) : (
          <StatTileFigure>None</StatTileFigure>
        )}
      </StatTile>
    </StatTileGrid>
  );
}

function NeedsAttention({
  steps,
  onOpenStep,
}: {
  steps: readonly UpgradeStepView[];
  onOpenStep: (stepId: string) => void;
}) {
  return (
    <Alert.Root status="error" data-testid="upgrade-needs-attention">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>Needs attention</Alert.Title>
        <Alert.Description>
          <Stack gap={1}>
            {steps.map((step) => (
              <Button
                key={step.id}
                variant="plain"
                size="xs"
                justifyContent="start"
                onClick={() => onOpenStep(step.id)}
              >
                {step.id}: {step.lastError ?? step.statusLabel}
              </Button>
            ))}
          </Stack>
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

function StepCounts({ counts }: { counts: Record<string, number> }) {
  return (
    <Wrap gap={1}>
      {Object.entries(counts)
        .filter(([, count]) => count > 0)
        .map(([status, count]) => (
          <Badge
            key={status}
            size="sm"
            variant="subtle"
            colorPalette={tonePalette(statusTone(status))}
          >
            {count} {status}
          </Badge>
        ))}
    </Wrap>
  );
}

function ReleasesTable({
  releases,
  onOpenRelease,
}: {
  releases: readonly UpgradeReleaseView[];
  onOpenRelease: (release: string) => void;
}) {
  return (
    <ListTable data-testid="upgrade-releases">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Release</Table.ColumnHeader>
          <Table.ColumnHeader>Here</Table.ColumnHeader>
          <Table.ColumnHeader>Steps</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {releases.map((release) => (
          <Table.Row
            key={release.release ?? UNRELEASED}
            cursor="pointer"
            onClick={() => onOpenRelease(release.release ?? UNRELEASED)}
          >
            <Table.Cell fontFamily="mono">{release.release ?? "Unreleased"}</Table.Cell>
            <Table.Cell>
              <Wrap gap={1}>
                {release.installed && <Badge size="sm">Installed</Badge>}
                {release.image && <Badge size="sm">This image</Badge>}
              </Wrap>
            </Table.Cell>
            <Table.Cell>
              <HStack gap={2}>
                <Text textStyle="sm">{release.stepCount}</Text>
                <StepCounts counts={release.counts} />
              </HStack>
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </ListTable>
  );
}

function RunsTable({
  runs,
  onOpenRun,
}: {
  runs: readonly UpgradeRunSummaryView[];
  onOpenRun: (runId: string) => void;
}) {
  if (runs.length === 0) return <Text color="fg.muted">No release upgrade has run yet.</Text>;
  return (
    <ListTable data-testid="upgrade-runs">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Outcome</Table.ColumnHeader>
          <Table.ColumnHeader>Release</Table.ColumnHeader>
          <Table.ColumnHeader>Kind</Table.ColumnHeader>
          <Table.ColumnHeader>Started</Table.ColumnHeader>
          <Table.ColumnHeader>Duration</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {runs.map((run) => (
          <Table.Row key={run.id} cursor="pointer" onClick={() => onOpenRun(run.id)}>
            <Table.Cell>
              <UpgradeStatusBadge label={runOutcomeLabel(run.outcome)} />
            </Table.Cell>
            <Table.Cell fontFamily="mono">{run.release ?? "Unreleased"}</Table.Cell>
            <Table.Cell>{run.kind}</Table.Cell>
            <Table.Cell>{readableDate(run.startedAt).toLocaleString()}</Table.Cell>
            <Table.Cell>{formatDuration(run.startedAt, run.finishedAt)}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </ListTable>
  );
}

function BackgroundSteps({
  steps,
  onOpenStep,
  onRetryStep,
  retryingStepId,
}: {
  steps: readonly UpgradeStepView[];
  onOpenStep: (stepId: string) => void;
  onRetryStep?: (stepId: string) => void;
  retryingStepId?: string | null;
}) {
  return (
    <ListTable data-testid="upgrade-background-steps">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Step</Table.ColumnHeader>
          <Table.ColumnHeader>Status</Table.ColumnHeader>
          <Table.ColumnHeader>Progress</Table.ColumnHeader>
          <Table.ColumnHeader>Release</Table.ColumnHeader>
          <Table.ColumnHeader>Last error</Table.ColumnHeader>
          <Table.ColumnHeader />
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {steps.map((step) => (
          <Table.Row
            key={step.id}
            cursor="pointer"
            onClick={() => onOpenStep(step.id)}
            data-testid={`upgrade-background-step-${step.id}`}
          >
            <Table.Cell fontFamily="mono">{step.id}</Table.Cell>
            <Table.Cell>
              <UpgradeStatusBadge
                label={{ label: step.statusLabel, tone: statusTone(step.status) }}
              />
            </Table.Cell>
            <Table.Cell>
              {step.progress && `${Math.floor((step.progress.done / step.progress.total) * 100)}%`}
            </Table.Cell>
            <Table.Cell fontFamily="mono">{step.release ?? "Unreleased"}</Table.Cell>
            <Table.Cell>{step.lastError}</Table.Cell>
            <Table.Cell textAlign="end">
              {onRetryStep && step.status === "failed" && (
                <Button
                  size="xs"
                  variant="outline"
                  loading={retryingStepId === step.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRetryStep(step.id);
                  }}
                >
                  Retry
                </Button>
              )}
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </ListTable>
  );
}

function OverviewBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap={3}>
      <Heading size="sm">{title}</Heading>
      {children}
    </Stack>
  );
}

/** W1: where the installation stands, its releases, background work and recent runs. */
export function UpgradesOverview({
  status,
  releases,
  runs,
  failedSteps,
  backgroundSteps = [],
  backgroundLoading = false,
  onRetryStep,
  retryingStepId,
  activeUpcasts,
  onOpenRelease,
  onOpenRun,
  onOpenStep,
}: UpgradesOverviewProps) {
  if (status.reason === "no-upgrade-recorded" && runs.length === 0) {
    return (
      <NoDataInfoBlock
        title="No release upgrade recorded"
        description="This installation has not recorded an upgrade yet. The first release upgrade records it."
        icon={<DatabaseZap />}
      />
    );
  }
  return (
    <Stack gap={6}>
      <StateHeadline status={status} />
      <ReleaseStrip status={status} />
      {failedSteps.length > 0 && <NeedsAttention steps={failedSteps} onOpenStep={onOpenStep} />}
      <OverviewBlock title="Releases">
        <ReleasesTable releases={releases} onOpenRelease={onOpenRelease} />
      </OverviewBlock>
      {(status.state === "finishing-in-background" ||
        backgroundSteps.length > 0 ||
        backgroundLoading ||
        activeUpcasts) && (
        <OverviewBlock title="Finishing in background">
          {status.state === "finishing-in-background" && (
            <Text textStyle="sm">{status.summary}</Text>
          )}
          {backgroundLoading && <Skeleton height="120px" aria-label="Loading background steps" />}
          {backgroundSteps.length > 0 && (
            <BackgroundSteps
              steps={backgroundSteps}
              onOpenStep={onOpenStep}
              onRetryStep={onRetryStep}
              retryingStepId={retryingStepId}
            />
          )}
          {activeUpcasts}
        </OverviewBlock>
      )}
      <OverviewBlock title="Recent runs">
        <RunsTable runs={runs} onOpenRun={onOpenRun} />
      </OverviewBlock>
    </Stack>
  );
}
