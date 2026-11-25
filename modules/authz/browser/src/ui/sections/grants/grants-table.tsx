/**
 * One holder's grants as a table: which role, where, until when, and the row actions. It
 * reads nothing; the grants and the actions arrive as props from the holder row.
 * specs/rbac/roles-and-access-ui.feature
 */

import { MoreVerticalIcon } from "@langwatch/design-system/icons";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { Badge, Button, Text } from "@langwatch/design-system/primitives";
import { format } from "@langwatch/time";

import { type GrantRow, grantPrincipalText, grantScopeText } from "../../../model/grants/grants.ts";

export type GrantsTableProps = {
  grants: readonly GrantRow[];
  /** Without it the rows carry no actions. */
  canManage: boolean;
  onChangeRole: (grant: GrantRow) => void;
  onRevoke: (grant: GrantRow) => void;
};

function grantText(grant: GrantRow): string {
  return `${grantPrincipalText(grant.principal)}: ${grant.role.name ?? grant.role.id} on ${grantScopeText(grant.scope)}`;
}

export function GrantsTable({ grants, canManage, onChangeRole, onRevoke }: GrantsTableProps) {
  return (
    <ListTable variant="embedded" aria-label="Role grants">
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>Role</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Where</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Until</ListTable.ColumnHeader>
          <ListTable.ActionHeader />
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {grants.map((grant) => (
          <ListTable.Row key={grant.id} data-testid="grant-row">
            <ListTable.Cell>
              <Badge size="sm" colorPalette={grant.role.builtIn ? "orange" : "purple"}>
                <Text as="span" truncate maxWidth="200px" title={grant.role.name ?? grant.role.id}>
                  {grant.role.name ?? grant.role.id}
                </Text>
              </Badge>
            </ListTable.Cell>
            <ListTable.Cell>
              <Text fontSize="sm">{grantScopeText(grant.scope)}</Text>
            </ListTable.Cell>
            <ListTable.Cell>
              {grant.status === "expired" ? (
                <Badge size="sm" colorPalette="red">
                  Expired
                </Badge>
              ) : (
                <Text fontSize="sm" color="fg.muted">
                  {grant.expiresAt ? format(grant.expiresAt, "d MMM yyyy") : "No end date"}
                </Text>
              )}
            </ListTable.Cell>
            <ListTable.ActionCell>
              {canManage && (
                <Menu.Root>
                  <Menu.Trigger asChild>
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-label={`Actions for ${grantText(grant)}`}
                      data-testid="grant-row-actions"
                    >
                      <MoreVerticalIcon size={14} aria-hidden />
                    </Button>
                  </Menu.Trigger>
                  <Menu.Content>
                    <Menu.Item
                      value="change"
                      onClick={() => onChangeRole(grant)}
                      data-testid="grant-change-role"
                    >
                      Change role
                    </Menu.Item>
                    <Menu.Item
                      value="revoke"
                      color="red.fg"
                      onClick={() => onRevoke(grant)}
                      data-testid="grant-revoke"
                    >
                      Revoke
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Root>
              )}
            </ListTable.ActionCell>
          </ListTable.Row>
        ))}
      </ListTable.Body>
    </ListTable>
  );
}
