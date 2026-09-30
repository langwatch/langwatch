/**
 * The Access tab: every grant in the organization, with granting, changing the role and
 * revoking. The list and dialogs are the kit's; the reads and writes are this module's.
 * specs/rbac/roles-and-access-ui.feature
 */

import { Button, Card, HStack, Spacer, VStack } from "@chakra-ui/react";
import {
  GrantRoleButton,
  GrantsTable,
  type GrantRow,
  RevokeGrantDialog,
} from "@langwatch/authz-browser-kit";
import type { GrantScopeType, GrantStatus } from "@langwatch/authz-contract";
import { useState } from "react";

import { useGrantList } from "../../behavior/use-grant-list.ts";
import { useGrantRevoke } from "../../behavior/use-grant-mutations.ts";
import { AccessGrantDialog } from "./access-grant-dialog.tsx";

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

const NEEDS_MANAGE = "You need permission to manage this organization to grant a role.";

export function AccessPanel({
  organizationId,
  canManage,
  refusal,
}: {
  organizationId: string;
  canManage: boolean;
  /** Why granting is refused beyond the reader's permission, such as the plan; wins over it. */
  refusal?: string | null;
}) {
  const list = useGrantList({ organizationId });
  const revoke = useGrantRevoke({ organizationId });
  const [dialog, setDialog] = useState<OpenDialog>({ kind: "none" });
  const [grantToRevoke, setGrantToRevoke] = useState<GrantRow | null>(null);
  const refused = refusal ?? (canManage ? null : NEEDS_MANAGE);

  return (
    <VStack align="start" gap={6} width="full">
      <HStack width="full" flexWrap="wrap" gap={4}>
        <FilterGroup
          filters={SCOPE_FILTERS}
          selected={list.scopeType}
          onSelect={list.selectScopeType}
        />
        <FilterGroup filters={STATUS_FILTERS} selected={list.status} onSelect={list.selectStatus} />
        <Spacer />
        <GrantRoleButton refusal={refused} onClick={() => setDialog({ kind: "grant" })} />
      </HStack>

      <Card.Root width="full" overflow="hidden">
        <Card.Body paddingY={0} paddingX={0} overflowX="auto">
          <GrantsTable
            isLoading={list.isLoading}
            isError={list.isError}
            grants={list.grants}
            refusal={refused}
            onChangeRole={(grant) => setDialog({ kind: "change", grant })}
            onRevoke={setGrantToRevoke}
          />
        </Card.Body>
      </Card.Root>

      {list.isPaged && (
        <HStack width="full" justify="end">
          <Button
            size="sm"
            variant="outline"
            disabled={!list.hasPrevious}
            onClick={list.previousPage}
          >
            Previous
          </Button>
          <Button size="sm" variant="outline" disabled={!list.hasNext} onClick={list.nextPage}>
            Next
          </Button>
        </HStack>
      )}

      {dialog.kind !== "none" && (
        <AccessGrantDialog
          key={dialog.kind === "change" ? dialog.grant.id : "new"}
          organizationId={organizationId}
          editing={dialog.kind === "change" ? dialog.grant : null}
          onClose={() => setDialog({ kind: "none" })}
        />
      )}

      <RevokeGrantDialog
        grant={grantToRevoke}
        loading={revoke.isRevoking}
        onCancel={() => setGrantToRevoke(null)}
        onConfirm={() => {
          if (!grantToRevoke) return;
          revoke.revoke({ grantId: grantToRevoke.id, onSettled: () => setGrantToRevoke(null) });
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
