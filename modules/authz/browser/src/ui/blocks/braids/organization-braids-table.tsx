// Every live braid in the organisation: from which project into which, the condition and the dates.
// Spec: modules/authz/specs/braids-screen.feature, "An organisation admin chooses who may braid".

import { Link } from "@langwatch/browser-host/link";
import { MoreVerticalIcon } from "@langwatch/design-system/icons";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import {
  Box,
  Button,
  HStack,
  Stack,
  Text,
  useBreakpointValue,
} from "@langwatch/design-system/primitives";

import {
  type OrganizationBraidRow,
  braidAuditHref,
  organizationBraidActionsLabel,
} from "../../../model/braids/braids.ts";
import { BraidCondition } from "../../elements/braid-condition.tsx";
import { BraidProjectLabel } from "../../elements/braid-project.tsx";
import { BRAID_WINDOW_HEADER, BraidCreated, BraidWindow } from "../../elements/braid-window.tsx";

const LABEL = "Braids in this organisation";

function RowActions({ row }: { row: OrganizationBraidRow }) {
  return (
    <ListTable.ActionCell>
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button size="xs" variant="ghost" aria-label={organizationBraidActionsLabel(row)}>
            <MoreVerticalIcon size={14} aria-hidden />
          </Button>
        </Menu.Trigger>
        <Menu.Content>
          <Menu.Item value="audit" asChild>
            <Link
              href={braidAuditHref({
                braidId: row.braidId,
                ownerName: row.owner.name,
                readerName: row.reader.name,
                ownerSlug: row.owner.slug,
              })}
            >
              View in audit log
            </Link>
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>
    </ListTable.ActionCell>
  );
}

function Window({ row, paused }: { row: OrganizationBraidRow; paused: boolean }) {
  return (
    <BraidWindow
      fromMs={row.fromMs}
      fromShowsTime={row.fromShowsTime}
      expiresAtMs={row.expiresAtMs}
      prefix={paused ? "Paused · " : undefined}
    />
  );
}

/** Below md each braid is one stacked cell, so nothing hides in a sideways scroller. */
function StackedTable({
  rows,
  paused,
}: {
  rows: readonly OrganizationBraidRow[];
  paused: boolean;
}) {
  return (
    <ListTable aria-label={LABEL} data-testid="organization-braids-stacked">
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>Braid</ListTable.ColumnHeader>
          <ListTable.ActionHeader />
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {rows.map((row) => (
          <ListTable.Row key={row.braidId} data-testid="organization-braid-row">
            <ListTable.Cell valign="top">
              <Stack gap={2} minWidth={0}>
                <BraidProjectLabel
                  project={row.owner}
                  detail={<BraidCreated atMs={row.createdAtMs} />}
                />
                <HStack gap={2} minWidth={0}>
                  <Text textStyle="xs" color="fg.muted">
                    Into
                  </Text>
                  <BraidProjectLabel project={row.reader} />
                </HStack>
                <BraidCondition where={row.where} />
                <Window row={row} paused={paused} />
              </Stack>
            </ListTable.Cell>
            <RowActions row={row} />
          </ListTable.Row>
        ))}
      </ListTable.Body>
    </ListTable>
  );
}

export function OrganizationBraidsTable({
  rows,
  paused,
}: {
  rows: readonly OrganizationBraidRow[];
  paused: boolean;
}) {
  const narrow = useBreakpointValue({ base: true, md: false }, { fallback: "md" }) === true;
  if (narrow) return <StackedTable rows={rows} paused={paused} />;
  return (
    <ListTable scroll="x" scrollLabel={LABEL} aria-label={LABEL}>
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>From</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Into</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Condition</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>{BRAID_WINDOW_HEADER}</ListTable.ColumnHeader>
          <ListTable.ActionHeader />
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {rows.map((row) => (
          <ListTable.Row key={row.braidId} data-testid="organization-braid-row">
            <ListTable.Cell>
              <BraidProjectLabel
                project={row.owner}
                detail={<BraidCreated atMs={row.createdAtMs} />}
              />
            </ListTable.Cell>
            <ListTable.Cell>
              <BraidProjectLabel project={row.reader} />
            </ListTable.Cell>
            <ListTable.Cell>
              <Box maxWidth="24rem">
                <BraidCondition where={row.where} />
              </Box>
            </ListTable.Cell>
            <ListTable.Cell nowrap>
              <Window row={row} paused={paused} />
            </ListTable.Cell>
            <RowActions row={row} />
          </ListTable.Row>
        ))}
      </ListTable.Body>
    </ListTable>
  );
}
