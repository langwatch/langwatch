// Every live braid in the organisation: from which project into which, the condition and the dates.
// Spec: modules/authz/specs/braids-screen.feature, "An organisation admin chooses who may braid".

import { Link } from "@langwatch/browser-host/link";
import { MoreVerticalIcon } from "@langwatch/design-system/icons";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { Box, Button } from "@langwatch/design-system/primitives";

import { type OrganizationBraidRow, braidAuditHref } from "../../../model/braids/braids.ts";
import { BraidCondition } from "../../elements/braid-condition.tsx";
import { BraidProjectLabel } from "../../elements/braid-project.tsx";
import { BRAID_WINDOW_HEADER, BraidCreated, BraidWindow } from "../../elements/braid-window.tsx";

export function OrganizationBraidsTable({
  rows,
  paused,
}: {
  rows: readonly OrganizationBraidRow[];
  paused: boolean;
}) {
  return (
    <ListTable
      scroll="x"
      scrollLabel="Braids in this organisation"
      aria-label="Braids in this organisation"
    >
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
              <BraidWindow
                fromMs={row.fromMs}
                fromShowsTime={row.fromShowsTime}
                expiresAtMs={row.expiresAtMs}
                prefix={paused ? "Paused · " : undefined}
              />
            </ListTable.Cell>
            <ListTable.ActionCell>
              <Menu.Root>
                <Menu.Trigger asChild>
                  <Button
                    size="xs"
                    variant="ghost"
                    aria-label={`Actions for the braid from ${row.owner.name} into ${row.reader.name}`}
                  >
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
                      })}
                    >
                      View in audit log
                    </Link>
                  </Menu.Item>
                </Menu.Content>
              </Menu.Root>
            </ListTable.ActionCell>
          </ListTable.Row>
        ))}
      </ListTable.Body>
    </ListTable>
  );
}
