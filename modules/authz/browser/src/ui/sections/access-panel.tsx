/**
 * The Access tab: every grant in the organization, one row each (who, which role,
 * where, until when), with granting, changing the role and revoking. It replaced
 * the role assignments list. specs/rbac/roles-and-access-ui.feature
 */

import {
  Badge,
  Box,
  Button,
  Card,
  HStack,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { GrantScopeType, GrantStatus } from "@langwatch/authz-contract";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Menu } from "@langwatch/design-system/menu";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { format } from "@langwatch/time";
import { MoreVertical, Plus } from "lucide-react";
import { useState } from "react";

import { authzApi } from "../../behavior/authz-api.ts";
import { useAuthzHost } from "../../model/authz-host.ts";
import { grantPrincipalText, type GrantRow, grantScopeText } from "../../model/grants.ts";
import { GrantDialog } from "./grant-dialog.tsx";

const PAGE_SIZE = 50;

const SCOPE_FILTERS: readonly { label: string; value: GrantScopeType | undefined }[] = [
  { label: "All", value: void 0 },
  { label: "Organization", value: "organization" },
  { label: "Team", value: "team" },
  { label: "Project", value: "project" },
];

const STATUS_FILTERS: readonly { label: string; value: GrantStatus | undefined }[] = [
  { label: "Any status", value: void 0 },
  { label: "Active", value: "active" },
  { label: "Expired", value: "expired" },
];

type OpenDialog = { kind: "none" } | { kind: "grant" } | { kind: "change"; grant: GrantRow };

export function AccessPanel({
  organizationId,
  canManage,
}: {
  organizationId: string;
  canManage: boolean;
}) {
  const host = useAuthzHost();
  const utils = authzApi.useUtils();
  const [scopeType, setScopeType] = useState<GrantScopeType | undefined>();
  const [status, setStatus] = useState<GrantStatus | undefined>();
  // The cursors of the pages before this one; the last is the page on screen.
  const [cursors, setCursors] = useState<string[]>([]);
  const [dialog, setDialog] = useState<OpenDialog>({ kind: "none" });
  const [grantToRevoke, setGrantToRevoke] = useState<GrantRow | null>(null);

  const page = authzApi.authz.listGrants.useQuery({
    organizationId,
    query: {
      limit: PAGE_SIZE,
      ...(scopeType ? { scopeType } : {}),
      ...(status ? { status } : {}),
      ...(cursors.length > 0 ? { cursor: cursors[cursors.length - 1] } : {}),
    },
  });
  const revokeGrant = authzApi.authz.revokeGrant.useMutation({
    onSuccess: () => {
      void utils.authz.listGrants.invalidate();
      void utils.roleBinding.listForOrg.invalidate();
      host.succeeded({ title: "Access revoked" });
    },
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't revoke this access" }),
  });

  const filterBy = (apply: () => void) => {
    apply();
    setCursors([]);
  };
  const nextCursor = page.data?.nextCursor ?? null;

  return (
    <VStack align="start" gap={6} width="full">
      <HStack width="full" flexWrap="wrap" gap={4}>
        <FilterGroup
          filters={SCOPE_FILTERS}
          selected={scopeType}
          onSelect={(value) => filterBy(() => setScopeType(value))}
        />
        <FilterGroup
          filters={STATUS_FILTERS}
          selected={status}
          onSelect={(value) => filterBy(() => setStatus(value))}
        />
        <Spacer />
        <Tooltip
          content="You need permission to manage this organization to grant a role."
          disabled={canManage}
        >
          <Button
            size="sm"
            colorPalette="blue"
            disabled={!canManage}
            onClick={() => setDialog({ kind: "grant" })}
            data-testid="grant-role-open"
          >
            <Plus size={14} aria-hidden />
            Grant role
          </Button>
        </Tooltip>
      </HStack>

      <Card.Root width="full" overflow="hidden">
        <Card.Body paddingY={0} paddingX={0} overflowX="auto">
          <GrantsTable
            isLoading={page.isLoading}
            isError={page.isError}
            grants={page.data?.grants ?? []}
            canManage={canManage}
            onChangeRole={(grant) => setDialog({ kind: "change", grant })}
            onRevoke={setGrantToRevoke}
          />
        </Card.Body>
      </Card.Root>

      {(cursors.length > 0 || nextCursor) && (
        <HStack width="full" justify="end">
          <Button
            size="sm"
            variant="outline"
            disabled={cursors.length === 0}
            onClick={() => setCursors(cursors.slice(0, -1))}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!nextCursor}
            onClick={() => nextCursor && setCursors([...cursors, nextCursor])}
          >
            Next
          </Button>
        </HStack>
      )}

      {dialog.kind !== "none" && (
        <GrantDialog
          key={dialog.kind === "change" ? dialog.grant.id : "new"}
          organizationId={organizationId}
          editing={dialog.kind === "change" ? dialog.grant : null}
          onClose={() => setDialog({ kind: "none" })}
        />
      )}

      <ConfirmDialog
        open={!!grantToRevoke}
        onOpenChange={(isOpen) => {
          if (!isOpen) setGrantToRevoke(null);
        }}
        title="Revoke this access"
        message={
          grantToRevoke
            ? `${grantPrincipalText(grantToRevoke.principal)} loses ${grantToRevoke.role.name ?? grantToRevoke.role.id} on ${grantScopeText(grantToRevoke.scope)}.`
            : ""
        }
        confirmLabel="Revoke"
        tone="danger"
        loading={revokeGrant.isPending}
        onConfirm={() => {
          if (!grantToRevoke) return;
          revokeGrant.mutate(
            { organizationId, grantId: grantToRevoke.id },
            { onSettled: () => setGrantToRevoke(null) },
          );
        }}
      />
    </VStack>
  );
}

function FilterGroup<T extends string>({
  filters,
  selected,
  onSelect,
}: {
  filters: readonly { label: string; value: T | undefined }[];
  selected: T | undefined;
  onSelect: (value: T | undefined) => void;
}) {
  return (
    <HStack gap={1}>
      {filters.map((filter) => (
        <Button
          key={filter.label}
          size="sm"
          variant={selected === filter.value ? "subtle" : "ghost"}
          colorPalette={selected === filter.value ? "blue" : "gray"}
          aria-pressed={selected === filter.value}
          onClick={() => onSelect(filter.value)}
        >
          {filter.label}
        </Button>
      ))}
    </HStack>
  );
}

/** Still reading, failed, nothing to show, or the rows. */
function GrantsTable({
  isLoading,
  isError,
  grants,
  canManage,
  onChangeRole,
  onRevoke,
}: {
  isLoading: boolean;
  isError: boolean;
  grants: readonly GrantRow[];
  canManage: boolean;
  onChangeRole: (grant: GrantRow) => void;
  onRevoke: (grant: GrantRow) => void;
}) {
  if (isLoading) {
    return (
      <Box padding={8} display="flex" justifyContent="center">
        <Spinner />
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
      <Box padding={8} textAlign="center">
        <Text color="fg.muted">Nobody has been granted a role here yet.</Text>
      </Box>
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
