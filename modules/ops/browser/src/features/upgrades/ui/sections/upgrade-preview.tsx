import { CopyButton } from "@langwatch/design-system/copy-button";
import { ListTable } from "@langwatch/design-system/list-table";
import {
  Alert,
  Code,
  Heading,
  HStack,
  Stack,
  Table,
  Text,
  Wrap,
} from "@langwatch/design-system/primitives";

import { preflightLabel } from "../../model/upgrade-labels.ts";
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
    <ListTable data-testid="upgrade-preview-releases">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Release</Table.ColumnHeader>
          {STEP_GROUPS.map((group) => (
            <Table.ColumnHeader key={group} textTransform="capitalize">
              {group}
            </Table.ColumnHeader>
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
                    <Code key={stepId} size="sm">
                      {stepId}
                    </Code>
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
    <ListTable data-testid="upgrade-preflight">
      <Table.Body>
        {rows.map((row) => (
          <Table.Row key={row.id} data-testid={`upgrade-preflight-${row.id}`}>
            <Table.Cell>
              <Stack gap={1}>
                <HStack justify="space-between">
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
      <Text textStyle="sm" data-testid="upgrade-preview-installed">
        Installed: {preview.installed ?? "None recorded"}
      </Text>
      {plan.outcome === "refused" ? (
        <Alert.Root status="error" data-testid="upgrade-preview-refused" data-code={plan.code}>
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{plan.message}</Alert.Title>
            {plan.stopAt && (
              <Alert.Description>
                <HStack gap={2}>
                  <Code>{plan.stopAt}</Code>
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
