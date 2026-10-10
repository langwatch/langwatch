import { CopyButton } from "@langwatch/design-system/copy-button";
import { InlineCode } from "@langwatch/design-system/inline-code";
import { ListTable } from "@langwatch/design-system/list-table";
import {
  Alert,
  Heading,
  HStack,
  Stack,
  Table,
  Text,
  Wrap,
} from "@langwatch/design-system/primitives";
import { StatTile, StatTileFigure, StatTileGrid } from "@langwatch/design-system/stat-tile";

import { modeLabel, preflightLabel } from "../../model/upgrade-labels.ts";
import type { UpgradePreviewView } from "../../model/upgrade-view.ts";
import { UpgradeStatusBadge } from "../elements/upgrade-status-badge.tsx";

type PlannedRelease = Extract<
  UpgradePreviewView["plan"],
  { outcome: "planned" }
>["releases"][number];

const STEP_GROUPS = ["schema", "blocking", "background", "operator"] as const;

function PlannedReleases({ releases }: { releases: readonly PlannedRelease[] }) {
  if (releases.length === 0) return <Text color="fg.muted">Nothing to apply.</Text>;
  return (
    <ListTable
      density="compact"
      columnRules={false}
      containerProps={{ overflowX: "auto" }}
      data-testid="upgrade-preview-releases"
    >
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Release</Table.ColumnHeader>
          {STEP_GROUPS.map((group) => (
            <Table.ColumnHeader key={group}>{modeLabel(group)}</Table.ColumnHeader>
          ))}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {releases.map((release) => (
          <Table.Row key={release.release ?? "unreleased"}>
            <Table.Cell fontFamily="mono">{release.release ?? "Unreleased"}</Table.Cell>
            {STEP_GROUPS.map((group) => (
              <Table.Cell key={group}>
                <Wrap gap={1}>
                  {release[group].map((stepId) => (
                    <InlineCode key={stepId}>{stepId}</InlineCode>
                  ))}
                </Wrap>
              </Table.Cell>
            ))}
          </Table.Row>
        ))}
      </Table.Body>
    </ListTable>
  );
}

function Preflight({ rows }: { rows: UpgradePreviewView["preflight"] }) {
  return (
    <ListTable
      density="compact"
      columnRules={false}
      containerProps={{ overflowX: "auto" }}
      data-testid="upgrade-preflight"
    >
      <Table.Body>
        {rows.map((row) => (
          <Table.Row key={row.id} data-testid={`upgrade-preflight-${row.id}`}>
            <Table.Cell>
              <Stack gap={1}>
                <HStack justify="space-between" wrap="wrap">
                  <Text fontWeight="medium">{row.name}</Text>
                  <UpgradeStatusBadge label={preflightLabel(row.outcome)} />
                </HStack>
                {row.detail && (
                  <Text textStyle="sm" color="fg.muted">
                    {row.detail}
                  </Text>
                )}
                {row.fix && <Text textStyle="sm">{row.fix}</Text>}
              </Stack>
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </ListTable>
  );
}

/** W5: what `upgrade plan --to` would apply, release by release, and the preflight it checks. */
export function UpgradePreview({ preview }: { preview: UpgradePreviewView }) {
  const plan = preview.plan;
  return (
    <Stack gap={6}>
      <StatTileGrid columns={3}>
        <StatTile variant="elevated" label="Installed" data-testid="upgrade-preview-installed">
          <StatTileFigure>{preview.installed ?? "None recorded"}</StatTileFigure>
        </StatTile>
        <StatTile variant="elevated" label="Planned releases">
          <StatTileFigure>
            {plan.outcome === "planned" ? plan.releases.length : "Unavailable"}
          </StatTileFigure>
        </StatTile>
        <StatTile variant="elevated" label="Preflight checks">
          <StatTileFigure>{preview.preflight.length}</StatTileFigure>
        </StatTile>
      </StatTileGrid>
      {plan.outcome === "refused" ? (
        <Alert.Root status="error" data-testid="upgrade-preview-refused" data-code={plan.code}>
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{plan.message}</Alert.Title>
            {plan.stopAt && (
              <Alert.Description>
                <HStack gap={2}>
                  <InlineCode>{plan.stopAt}</InlineCode>
                  <CopyButton value={plan.stopAt} label="Copy release" />
                </HStack>
              </Alert.Description>
            )}
          </Alert.Content>
        </Alert.Root>
      ) : (
        <Stack gap={3}>
          <Heading size="sm">Plan</Heading>
          <PlannedReleases releases={plan.releases} />
        </Stack>
      )}
      <Stack gap={3}>
        <Heading size="sm">Preflight</Heading>
        <Preflight rows={preview.preflight} />
      </Stack>
    </Stack>
  );
}
