import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import {
  Button,
  Heading,
  HStack,
  Link,
  Stack,
  Table,
  Text,
} from "@langwatch/design-system/primitives";
import { DatabaseZap, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";

import { upgradeStateLine, versionLine } from "../../model/upgrade-labels.ts";
import type { UpgradeStatusView, UpgradeStepView } from "../../model/upgrade-view.ts";
import { UpgradeStatusBadge } from "../elements/upgrade-status-badge.tsx";
import { UpgradePendingSteps } from "./upgrade-pending-steps.tsx";

export type UpgradesOverviewProps = {
  status: UpgradeStatusView;
  /** Whether the ledger lists any run; with none and nothing recorded, the overview says so. */
  hasRuns: boolean;
  /** Operator steps not yet done, from `listSteps({ mode: "operator" })`. */
  operatorSteps?: readonly UpgradeStepView[];
  /** Given only to an `ops:manage` reader: failed steps offer Retry. */
  onRetryStep?: (stepId: string) => void;
  retryingStepId?: string | null;
  onOpenStep: (stepId: string) => void;
  /** Organizations a tenant step holds or parks, counted once each. */
  heldOrganizations?: number;
  /** Self-hosted has no staff to resolve a held organization, so the line names its owner. */
  sharedInstall?: boolean;
  onOpenOrganizations?: () => void;
};

/** The one state line; Needs attention offers one Retry that reopens every failed step. */
function StateLine({
  status,
  onRetryStep,
  retryingStepId,
  heldOrganizations,
  sharedInstall,
  onOpenOrganizations,
}: {
  status: UpgradeStatusView;
  onRetryStep?: (stepId: string) => void;
  retryingStepId?: string | null;
  heldOrganizations?: number;
  sharedInstall?: boolean;
  onOpenOrganizations?: () => void;
}) {
  const line = upgradeStateLine({ ...status, heldOrganizations });
  const retrying =
    retryingStepId !== null && status.failedStepIds.some((id) => id === retryingStepId);
  return (
    <HStack gap={3} flexWrap="wrap" data-testid="upgrade-installation-state">
      <UpgradeStatusBadge label={{ label: line.text, tone: line.tone }} size="lg" />
      {line.retry && onRetryStep && (
        <Button
          size="xs"
          variant="outline"
          loading={retrying}
          onClick={() => {
            for (const id of status.failedStepIds) onRetryStep(id);
          }}
          data-testid="upgrade-retry-failed"
        >
          Retry
        </Button>
      )}
      {line.organizations && !sharedInstall && (
        <Text textStyle="sm" color="fg.muted" data-testid="upgrade-held-contact-owner">
          Contact the organization owner.
        </Text>
      )}
      {line.organizations && onOpenOrganizations && (
        <Button
          size="xs"
          variant="outline"
          onClick={onOpenOrganizations}
          data-testid="upgrade-open-held-organizations"
        >
          View organizations
        </Button>
      )}
    </HStack>
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

function OverviewBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap={3}>
      <Heading size="sm">{title}</Heading>
      {children}
    </Stack>
  );
}

/** W1 (ADR-173 section 7): the running version, one state, this version's operator steps. */
export function UpgradesOverview({
  status,
  hasRuns,
  operatorSteps = [],
  onRetryStep,
  retryingStepId = null,
  onOpenStep,
  heldOrganizations,
  sharedInstall = true,
  onOpenOrganizations,
}: UpgradesOverviewProps) {
  if (status.reason === "no-upgrade-recorded" && !hasRuns) {
    return (
      <NoDataInfoBlock
        title="No release upgrade recorded"
        description="This installation has not recorded an upgrade yet. The worker records it when it runs the first upgrade."
        icon={<DatabaseZap />}
      />
    );
  }
  return (
    <Stack gap={6}>
      <Stack gap={3}>
        <Heading size="md" data-testid="upgrade-version">
          {versionLine(status.version)}
        </Heading>
        <StateLine
          status={status}
          onRetryStep={onRetryStep}
          retryingStepId={retryingStepId}
          heldOrganizations={heldOrganizations}
          sharedInstall={sharedInstall}
          onOpenOrganizations={onOpenOrganizations}
        />
      </Stack>
      {operatorSteps.length > 0 && (
        <OverviewBlock title="Action needed">
          <UpgradePendingSteps
            group="operator"
            steps={operatorSteps}
            onOpenStep={onOpenStep}
            onRetryStep={onRetryStep}
            retryingStepId={retryingStepId}
          />
        </OverviewBlock>
      )}
      {status.latestRelease && (
        <HStack gap={3} flexWrap="wrap" data-testid="upgrade-latest-release">
          <Text textStyle="sm">Newer version {status.latestRelease.release} available</Text>
          <Link
            href={status.latestRelease.notesUrl}
            target="_blank"
            rel="noopener noreferrer"
            textStyle="sm"
          >
            Release notes <ExternalLink size={12} />
          </Link>
        </HStack>
      )}
      {status.deprecations.length > 0 && (
        <OverviewBlock title="Deprecated">
          <DeprecationsTable deprecations={status.deprecations} />
        </OverviewBlock>
      )}
    </Stack>
  );
}
