import { CopyButton } from "@langwatch/design-system/copy-button";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { InlineCode } from "@langwatch/design-system/inline-code";
import { ListTable } from "@langwatch/design-system/list-table";
import { MeterBar } from "@langwatch/design-system/meter-bar";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import {
  Alert,
  Badge,
  Button,
  Heading,
  HStack,
  Skeleton,
  Stack,
  Table,
  Text,
  Wrap,
} from "@langwatch/design-system/primitives";
import { StatTile, StatTileFigure, StatTileGrid } from "@langwatch/design-system/stat-tile";
import { DatabaseZap } from "lucide-react";
import type { ReactNode } from "react";

import type { RouterOutputs } from "../../../../behavior/ops-api.ts";
import { formatDuration } from "../../../../model/ops-formatters.ts";
import {
  isFinished,
  orderReleasesNewestFirst,
  remainingCount,
  runOutcomeLabel,
  statusTone,
  statusWords,
  summariseError,
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
import { UpgradeErrorSummary } from "../elements/upgrade-error-summary.tsx";
import { UpgradeStatusBadge } from "../elements/upgrade-status-badge.tsx";
import { UpgradeStepState } from "../elements/upgrade-step-state.tsx";

/** U4: one tenant step (`name` is its step id) with its tenants' state counts, as served. */
export type UpgradeTenantStepView = RouterOutputs["ops"]["upgrade"]["listSystemMigrations"][number];

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
  /** Operator steps not yet done, from `listSteps({ mode: "operator" })`. */
  operatorSteps?: readonly UpgradeStepView[];
  /** Tenant steps with their tenants' progress, from `listSystemMigrations`. */
  tenantSteps?: readonly UpgradeTenantStepView[];
  /** Given only to an `ops:manage` reader: a failed background or operator step offers Retry. */
  onRetryStep?: (stepId: string) => void;
  retryingStepId?: string | null;
  /** The eventing upcaster's "active upcasts" reading, mounted by the screen once it exists. */
  activeUpcasts?: ReactNode;
  onOpenRelease: (release: string) => void;
  onOpenRun: (runId: string) => void;
  onOpenStep: (stepId: string) => void;
  /** Opens the Tenant migrations tab, where enrolment and per-organization actions live. */
  onManageTenants?: () => void;
};

function StateHeadline({ status }: { status: UpgradeStatusView }) {
  const command = upgradeCommandFor({ reason: status.reason });
  return (
    <Stack gap={3} data-testid="upgrade-installation-state">
      <HStack gap={3} flexWrap="wrap">
        <UpgradeStatusBadge label={{ label: status.label, tone: toneOf(status.tone) }} size="lg" />
        <Text textStyle="sm" color="fg.muted">
          {status.summary}
        </Text>
      </HStack>
      {command && (
        <HStack gap={2}>
          <InlineCode>{command}</InlineCode>
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
      <StatTile variant="elevated" label="Installed" data-testid="upgrade-installed">
        <StatTileFigure>{status.installed ?? "None recorded"}</StatTileFigure>
      </StatTile>
      <StatTile variant="elevated" label="Image" data-testid="upgrade-image">
        <StatTileFigure>{status.image}</StatTileFigure>
      </StatTile>
      <StatTile variant="elevated" label="LTS floor" data-testid="upgrade-floor">
        <StatTileFigure>{status.floor ?? "Not named"}</StatTileFigure>
      </StatTile>
      <StatTile
        variant="elevated"
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
                <Text as="span" fontFamily="mono">
                  {step.id}
                </Text>
                : {step.lastError ? summariseError(step.lastError) : step.statusLabel}
              </Button>
            ))}
          </Stack>
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

/** The unfinished counts as badges in their tone, e.g. "3 pending", "1 failed". */
function RemainingBadges({ counts }: { counts: Record<string, number> }) {
  return (
    <Wrap gap={1}>
      {Object.entries(counts)
        .filter(([status, count]) => count > 0 && !isFinished(status))
        .map(([status, count]) => (
          <Badge
            key={status}
            size="sm"
            variant="solid"
            colorPalette={
              statusTone(status) === "neutral" ? "orange" : tonePalette(statusTone(status))
            }
          >
            {count} {statusWords(status)}
          </Badge>
        ))}
    </Wrap>
  );
}

function ReleaseProgress({ release }: { release: UpgradeReleaseView }) {
  if (release.stepCount === 0) {
    return (
      <Text textStyle="sm" color="fg.muted">
        No steps
      </Text>
    );
  }
  const done = release.counts.done ?? 0;
  const notNeeded = release.counts["not-needed"] ?? 0;
  return (
    <Stack gap={1}>
      <MeterBar
        fillRatio={(done + notNeeded) / release.stepCount}
        width="160px"
        height="6px"
        fillColor="green.solid"
      />
      <Text textStyle="xs" color="fg.muted" whiteSpace="nowrap">
        {done} of {release.stepCount} done
        {notNeeded > 0 && ` · ${notNeeded} not needed`}
      </Text>
    </Stack>
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
    <ListTable
      density="compact"
      columnRules={false}
      containerProps={{ overflowX: "auto" }}
      data-testid="upgrade-releases"
    >
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Release</Table.ColumnHeader>
          <Table.ColumnHeader>Still to do</Table.ColumnHeader>
          <Table.ColumnHeader>Progress</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {orderReleasesNewestFirst(releases).map((release) => {
          const remaining = remainingCount(release.counts);
          return (
            <Table.Row
              key={release.release ?? UNRELEASED}
              cursor="pointer"
              onClick={() => onOpenRelease(release.release ?? UNRELEASED)}
              data-testid={`upgrade-release-${release.release ?? UNRELEASED}`}
            >
              <Table.Cell>
                <HStack gap={2}>
                  <Text fontFamily="mono" textStyle="sm" fontWeight="medium">
                    {release.release ?? "Unreleased"}
                  </Text>
                  {release.installed && (
                    <Badge size="sm" colorPalette="green" variant="subtle">
                      Installed
                    </Badge>
                  )}
                  {release.image && (
                    <Badge size="sm" colorPalette="blue" variant="subtle">
                      This image
                    </Badge>
                  )}
                </HStack>
              </Table.Cell>
              <Table.Cell>
                {remaining > 0 ? (
                  <RemainingBadges counts={release.counts} />
                ) : (
                  <Text textStyle="sm" color="fg.muted">
                    {release.stepCount === 0 ? "Nothing" : "All applied"}
                  </Text>
                )}
              </Table.Cell>
              <Table.Cell>
                <ReleaseProgress release={release} />
              </Table.Cell>
            </Table.Row>
          );
        })}
      </Table.Body>
    </ListTable>
  );
}

/** What this image still ships but retires, what replaces each and when it goes (ruling D8). */
function DeprecationsTable({ deprecations }: { deprecations: UpgradeStatusView["deprecations"] }) {
  return (
    <ListTable
      density="compact"
      columnRules={false}
      containerProps={{ overflowX: "auto" }}
      data-testid="upgrade-deprecations"
    >
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Deprecated</Table.ColumnHeader>
          <Table.ColumnHeader>Replaced by</Table.ColumnHeader>
          <Table.ColumnHeader>Removed in</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {deprecations.map((entry) => (
          <Table.Row key={entry.id}>
            <Table.Cell>
              <Text fontWeight="medium">{entry.what}</Text>
              <Text textStyle="xs" color="fg.muted">
                {entry.notice}
              </Text>
            </Table.Cell>
            <Table.Cell>{entry.successor ?? "Nothing"}</Table.Cell>
            <Table.Cell whiteSpace="nowrap">{entry.removedIn ?? "A future release"}</Table.Cell>
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
  if (runs.length === 0) {
    return (
      <Text textStyle="sm" color="fg.muted">
        No release upgrade has run yet.
      </Text>
    );
  }
  return (
    <ListTable
      density="compact"
      columnRules={false}
      containerProps={{ overflowX: "auto" }}
      data-testid="upgrade-runs"
    >
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Outcome</Table.ColumnHeader>
          <Table.ColumnHeader>Release</Table.ColumnHeader>
          <Table.ColumnHeader>Kind</Table.ColumnHeader>
          <Table.ColumnHeader>Started</Table.ColumnHeader>
          <Table.ColumnHeader textAlign="end">Duration</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {runs.map((run) => (
          <Table.Row key={run.id} cursor="pointer" onClick={() => onOpenRun(run.id)}>
            <Table.Cell>
              <UpgradeStatusBadge label={runOutcomeLabel(run.outcome)} />
            </Table.Cell>
            <Table.Cell fontFamily="mono">{run.release ?? "Unreleased"}</Table.Cell>
            <Table.Cell textTransform="capitalize">{run.kind}</Table.Cell>
            <Table.Cell whiteSpace="nowrap">
              <FormattedDate value={run.startedAt} />
            </Table.Cell>
            <Table.Cell textAlign="end" whiteSpace="nowrap">
              {formatDuration(run.startedAt, run.finishedAt)}
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </ListTable>
  );
}

function PendingSteps({
  group,
  steps,
  onOpenStep,
  onRetryStep,
  retryingStepId,
}: {
  group: "background" | "operator";
  steps: readonly UpgradeStepView[];
  onOpenStep: (stepId: string) => void;
  onRetryStep?: (stepId: string) => void;
  retryingStepId?: string | null;
}) {
  const show = {
    release: steps.some((step) => step.release !== null),
    finishBy: steps.some((step) => step.finishBy !== null),
    error: steps.some((step) => step.lastError !== null),
    retry: onRetryStep !== void 0 && steps.some((step) => step.status === "failed"),
  };
  return (
    <ListTable
      density="compact"
      columnRules={false}
      containerProps={{ overflowX: "auto" }}
      data-testid={`upgrade-${group}-steps`}
    >
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Step</Table.ColumnHeader>
          <Table.ColumnHeader>Status</Table.ColumnHeader>
          {show.release && <Table.ColumnHeader>Release</Table.ColumnHeader>}
          {show.finishBy && <Table.ColumnHeader whiteSpace="nowrap">Finish by</Table.ColumnHeader>}
          {show.error && <Table.ColumnHeader>Last error</Table.ColumnHeader>}
          {show.retry && <Table.ColumnHeader aria-label="Actions" />}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {steps.map((step) => (
          <Table.Row
            key={step.id}
            cursor="pointer"
            onClick={() => onOpenStep(step.id)}
            data-testid={`upgrade-${group}-step-${step.id}`}
          >
            <Table.Cell fontFamily="mono" whiteSpace="nowrap" verticalAlign="top">
              {step.id}
            </Table.Cell>
            <Table.Cell verticalAlign="top">
              <UpgradeStepState step={step} />
            </Table.Cell>
            {show.release && (
              <Table.Cell fontFamily="mono" verticalAlign="top">
                {step.release ?? "Unreleased"}
              </Table.Cell>
            )}
            {show.finishBy && (
              <Table.Cell fontFamily="mono" verticalAlign="top">
                {step.finishBy}
              </Table.Cell>
            )}
            {show.error && (
              <Table.Cell maxWidth="420px" verticalAlign="top">
                {step.lastError && <UpgradeErrorSummary error={step.lastError} />}
              </Table.Cell>
            )}
            {show.retry && (
              <Table.Cell textAlign="end" verticalAlign="top">
                {step.status === "failed" && (
                  <Button
                    size="xs"
                    variant="outline"
                    loading={retryingStepId === step.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRetryStep?.(step.id);
                    }}
                  >
                    Retry
                  </Button>
                )}
              </Table.Cell>
            )}
          </Table.Row>
        ))}
      </Table.Body>
    </ListTable>
  );
}

/** A tenant count: a zero stays quiet, a non-zero Held or Parked takes its tone. */
function TenantCount({ count, palette }: { count: number; palette?: string }) {
  if (count === 0 || !palette) {
    return (
      <Text as="span" textStyle="sm" color={count === 0 ? "fg.subtle" : void 0}>
        {count}
      </Text>
    );
  }
  return (
    <Badge size="sm" variant="subtle" colorPalette={palette}>
      {count}
    </Badge>
  );
}

function TenantSteps({
  steps,
  onOpenStep,
}: {
  steps: readonly UpgradeTenantStepView[];
  onOpenStep: (stepId: string) => void;
}) {
  return (
    <ListTable
      density="compact"
      columnRules={false}
      containerProps={{ overflowX: "auto" }}
      data-testid="upgrade-tenant-steps"
    >
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Step</Table.ColumnHeader>
          <Table.ColumnHeader textAlign="end">Finalized</Table.ColumnHeader>
          <Table.ColumnHeader textAlign="end">Held</Table.ColumnHeader>
          <Table.ColumnHeader textAlign="end">Parked</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {steps.map((step) => (
          <Table.Row
            key={step.name}
            cursor="pointer"
            onClick={() => onOpenStep(step.name)}
            data-testid={`upgrade-tenant-step-${step.name}`}
          >
            <Table.Cell>
              <Stack gap={0}>
                <Text textStyle="sm">{step.title}</Text>
                <Text textStyle="xs" color="fg.muted" fontFamily="mono">
                  {step.name}
                </Text>
              </Stack>
            </Table.Cell>
            <Table.Cell textAlign="end">
              <TenantCount count={step.counts.finalized} />
            </Table.Cell>
            <Table.Cell textAlign="end">
              <TenantCount count={step.counts.migrated} palette="orange" />
            </Table.Cell>
            <Table.Cell textAlign="end">
              <TenantCount count={step.counts.parked} palette="red" />
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </ListTable>
  );
}

function OverviewBlock({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Stack gap={3}>
      <HStack justify="space-between">
        <Heading size="sm">{title}</Heading>
        {action}
      </HStack>
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
  operatorSteps = [],
  tenantSteps = [],
  onRetryStep,
  retryingStepId,
  activeUpcasts,
  onOpenRelease,
  onOpenRun,
  onOpenStep,
  onManageTenants,
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
      {(backgroundSteps.length > 0 || backgroundLoading || activeUpcasts) && (
        <OverviewBlock title="Finishing in background">
          {backgroundLoading && <Skeleton height="120px" aria-label="Loading background steps" />}
          {backgroundSteps.length > 0 && (
            <PendingSteps
              group="background"
              steps={backgroundSteps}
              onOpenStep={onOpenStep}
              onRetryStep={onRetryStep}
              retryingStepId={retryingStepId}
            />
          )}
          {activeUpcasts}
        </OverviewBlock>
      )}
      {operatorSteps.length > 0 && (
        <OverviewBlock title="Operator steps">
          <PendingSteps
            group="operator"
            steps={operatorSteps}
            onOpenStep={onOpenStep}
            onRetryStep={onRetryStep}
            retryingStepId={retryingStepId}
          />
        </OverviewBlock>
      )}
      {tenantSteps.length > 0 && (
        <OverviewBlock
          title="Tenant steps"
          action={
            onManageTenants && (
              <Button size="xs" variant="ghost" onClick={onManageTenants}>
                Manage tenant migrations
              </Button>
            )
          }
        >
          <TenantSteps steps={tenantSteps} onOpenStep={onOpenStep} />
        </OverviewBlock>
      )}
      <OverviewBlock title="Recent runs">
        <RunsTable runs={runs} onOpenRun={onOpenRun} />
      </OverviewBlock>
      {status.deprecations.length > 0 && (
        <OverviewBlock title="Deprecated">
          <DeprecationsTable deprecations={status.deprecations} />
        </OverviewBlock>
      )}
    </Stack>
  );
}
