/**
 * One holder's grants as a table: which role, where, until when, and the row actions. It
 * reads nothing; the grants and the actions arrive as props from the holder row.
 * specs/rbac/roles-and-access-ui.feature
 */

import { Menu } from "@langwatch/design-system/menu";
import { Badge, Button, Table, Text } from "@langwatch/design-system/primitives";
import { format } from "@langwatch/time";
import { MoreVertical } from "lucide-react";

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
    <Table.Root variant="line" size="sm" width="full">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Role</Table.ColumnHeader>
          <Table.ColumnHeader>Where</Table.ColumnHeader>
          <Table.ColumnHeader>Until</Table.ColumnHeader>
          <Table.ColumnHeader width="48px" />
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {grants.map((grant) => (
          <Table.Row key={grant.id} data-testid="grant-row">
            <Table.Cell>
              <Badge size="sm" colorPalette={grant.role.builtIn ? "orange" : "purple"}>
                {grant.role.name ?? grant.role.id}
              </Badge>
            </Table.Cell>
            <Table.Cell>
              <Text fontSize="sm">{grantScopeText(grant.scope)}</Text>
            </Table.Cell>
            <Table.Cell>
              {grant.status === "expired" ? (
                <Badge size="sm" colorPalette="red">
                  Expired
                </Badge>
              ) : (
                <Text fontSize="sm" color="fg.muted">
                  {grant.expiresAt ? format(grant.expiresAt, "d MMM yyyy") : "No end date"}
                </Text>
              )}
            </Table.Cell>
            <Table.Cell>
              {canManage && (
                <Menu.Root>
                  <Menu.Trigger asChild>
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-label={`Actions for ${grantText(grant)}`}
                      data-testid="grant-row-actions"
                    >
                      <MoreVertical size={14} />
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
                      color="red.500"
                      onClick={() => onRevoke(grant)}
                      data-testid="grant-revoke"
                    >
                      Revoke
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Root>
              )}
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}
