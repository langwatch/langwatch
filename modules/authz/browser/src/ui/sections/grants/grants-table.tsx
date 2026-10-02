/**
 * The grants as a table: who, which role, where, until when. It reads nothing; the rows, the
 * loading and error states and the row actions arrive as props.
 * specs/rbac/roles-and-access-ui.feature
 */

import { Menu } from "@langwatch/design-system/menu";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Badge, Box, Button, SkeletonText, Table, Text } from "@langwatch/design-system/primitives";
import { format } from "@langwatch/time";
import { KeyRound, MoreVertical } from "lucide-react";

import { type GrantRow, grantPrincipalText, grantScopeText } from "../../../model/grants/grants.ts";

export type GrantsTableProps = {
  grants: readonly GrantRow[];
  isLoading: boolean;
  isError: boolean;
  /** Without it the rows carry no actions. */
  canManage: boolean;
  onChangeRole: (grant: GrantRow) => void;
  onRevoke: (grant: GrantRow) => void;
};

/** Still reading, failed, nothing to show, or the rows. */
export function GrantsTable({
  grants,
  isLoading,
  isError,
  canManage,
  onChangeRole,
  onRevoke,
}: GrantsTableProps) {
  if (isLoading) {
    return (
      <Box padding={4} data-testid="grants-loading">
        <SkeletonText noOfLines={4} gap={4} />
      </Box>
    );
  }
  if (isError) {
    return (
      <Box padding={8} textAlign="center">
        <Text color="fg.error">Couldn't load who has access.</Text>
      </Box>
    );
  }
  if (grants.length === 0) {
    return (
      <NoDataInfoBlock
        title="Nobody has been granted a role here yet."
        description="Grant a role to give somebody access to an organization, team or project."
        icon={<KeyRound />}
      />
    );
  }

  return (
    <Table.Root variant="line" size="md" width="full">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Who</Table.ColumnHeader>
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
              <Text fontSize="sm" fontWeight="medium">
                {grantPrincipalText(grant.principal)}
              </Text>
              {grant.principal.type !== "user" && (
                <Badge size="xs" colorPalette="gray">
                  {grant.principal.type === "group" ? "Group" : "API key"}
                </Badge>
              )}
            </Table.Cell>
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
                      aria-label={`Actions for ${grantPrincipalText(grant.principal)}`}
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
