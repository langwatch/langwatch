// What a role can do and who holds one (main's RolesPanel): the predefined ladder
// first, then the organization's own roles; counts and holders fold out of the assignments.

import { Link } from "@langwatch/browser-host/link";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import {
  Alert,
  Box,
  Button,
  Heading,
  HStack,
  Skeleton,
  Spacer,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Plus, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";

import { authzApi, type RouterOutputs } from "../../behavior/authz-api.ts";
import { useAuthzHost } from "../../model/authz-host.ts";
import {
  BUILTIN_ROLE_CARDS,
  builtinRoleGrantedPermissions,
  peopleHoldingBuiltinRole,
} from "../../model/builtin-roles.ts";
import type { ManagedGrant } from "../../model/managed-grant.ts";
import {
  holdersOfCustomRole,
  peopleHoldingCustomRole,
  scopesOfCustomRole,
} from "../../model/role-holders.ts";
import { BuiltinRoleCard, CustomRoleCard } from "../blocks/role-cards.tsx";
import { RoleDetailDialog } from "../blocks/role-detail-dialog.tsx";
import { RoleDialog } from "./role-dialog.tsx";

type Role = RouterOutputs["role"]["getAll"][number];

type RoleDetail = { title: string; description: string | null; permissions: readonly string[] };

type OpenDialog =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "edit"; role: Role }
  | ({ kind: "detail" } & RoleDetail);

const NO_ASSIGNMENTS: ManagedGrant[] = [];

export function RolesPanel({
  organizationId,
  canManage,
  canReadAuditLog,
}: {
  organizationId: string;
  canManage: boolean;
  canReadAuditLog: boolean;
}) {
  const host = useAuthzHost();
  const [dialog, setDialog] = useState<OpenDialog>({ kind: "none" });
  const [roleToDelete, setRoleToDelete] = useState<Role | null>(null);

  const utils = authzApi.useUtils();
  const roles = authzApi.role.getAll.useQuery({ organizationId });
  const assignments = authzApi.authz.listManagedGrants.useQuery(
    { organizationId },
    { enabled: !!organizationId },
  );
  const assignmentRows = assignments.data ?? NO_ASSIGNMENTS;
  // Losing the assignments costs the counts and holders, never the roles;
  // null is "unknown", not zero.
  const assignmentsUnavailable = assignments.isError;
  const countsPending = assignments.isLoading || assignmentsUnavailable;

  const deleteRole = authzApi.role.delete.useMutation({
    onSuccess: () => {
      void utils.role.getAll.invalidate();
      void utils.authz.listManagedGrants.invalidate();
      host.succeeded({ title: "Role deleted" });
    },
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't delete this role" }),
  });

  const closeDialog = () => setDialog({ kind: "none" });

  return (
    <VStack align="stretch" width="full" gap={8}>
      <VStack align="stretch" width="full" gap={4}>
        <SectionHeading
          title="Predefined roles"
          hint="Three roles cover most teams. They cannot be changed or deleted."
        />
        {assignmentsUnavailable && (
          <SectionErrorNotice title="Couldn't work out who holds each role" />
        )}
        <Box
          width="full"
          display="grid"
          gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))"
          gap={4}
        >
          {BUILTIN_ROLE_CARDS.map((card) => (
            <BuiltinRoleCard
              key={card.teamRole}
              card={card}
              people={
                countsPending
                  ? null
                  : peopleHoldingBuiltinRole({ bindings: assignmentRows, teamRole: card.teamRole })
              }
              totalPermissions={builtinRoleGrantedPermissions(card.teamRole).length}
              onOpenDetail={() =>
                setDialog({
                  kind: "detail",
                  title: card.name,
                  description: card.description,
                  permissions: builtinRoleGrantedPermissions(card.teamRole),
                })
              }
            />
          ))}
        </Box>
      </VStack>

      <VStack align="stretch" width="full" gap={4}>
        <SectionHeading
          title="Custom roles"
          hint="Scoped grants for people who need one thing and nothing else."
          right={
            <Tooltip
              content="You need permission to manage this organization to write a role."
              disabled={canManage}
            >
              <Button
                size="sm"
                colorPalette="orange"
                onClick={() => setDialog({ kind: "create" })}
                disabled={!canManage}
                data-testid="authz-role-create"
              >
                <Plus size={14} aria-hidden />
                New role
              </Button>
            </Tooltip>
          }
        />

        {roles.isError ? (
          <SectionErrorNotice title="Couldn't load your custom roles" />
        ) : (
          <CustomRoleCards
            roles={roles.data}
            assignments={assignmentsUnavailable ? null : assignmentRows}
            canManage={canManage}
            onOpenDetail={(role) =>
              setDialog({
                kind: "detail",
                title: role.name,
                description: role.description,
                permissions: role.permissions,
              })
            }
            onEdit={(role) => setDialog({ kind: "edit", role })}
            onDelete={setRoleToDelete}
          />
        )}

        {canReadAuditLog && (
          <Text fontSize="xs" color="fg.muted">
            Every role you write, change or hand to somebody is recorded in the{" "}
            <Link href="/settings/audit-log" fontSize="xs">
              audit log
            </Link>
            .
          </Text>
        )}
      </VStack>

      <RoleDialog
        open={dialog.kind === "create" || dialog.kind === "edit"}
        organizationId={organizationId}
        editing={dialog.kind === "edit" ? dialog.role : null}
        onClose={closeDialog}
      />

      <RoleDetailDialog
        open={dialog.kind === "detail"}
        onClose={closeDialog}
        title={dialog.kind === "detail" ? dialog.title : ""}
        description={dialog.kind === "detail" ? dialog.description : null}
        permissions={dialog.kind === "detail" ? dialog.permissions : []}
      />

      <ConfirmDialog
        open={!!roleToDelete}
        onOpenChange={(isOpen) => {
          if (!isOpen) setRoleToDelete(null);
        }}
        title="Delete this role"
        message={`Everyone holding "${roleToDelete?.name ?? ""}" loses what it grants them. This cannot be undone.`}
        confirmLabel="Delete"
        tone="danger"
        loading={deleteRole.isPending}
        onConfirm={() => {
          if (!roleToDelete) return;
          deleteRole.mutate(
            { roleId: roleToDelete.id },
            { onSettled: () => setRoleToDelete(null) },
          );
        }}
      />
    </VStack>
  );
}

/** The organization's own roles; `assignments` is null when they could not be read. */
function CustomRoleCards({
  roles,
  assignments,
  canManage,
  onOpenDetail,
  onEdit,
  onDelete,
}: {
  roles: readonly Role[] | undefined;
  assignments: readonly ManagedGrant[] | null;
  canManage: boolean;
  onOpenDetail: (role: Role) => void;
  onEdit: (role: Role) => void;
  onDelete: (role: Role) => void;
}) {
  if (!roles) {
    return (
      <VStack align="stretch" width="full" gap={4}>
        <Skeleton height="96px" borderRadius="xl" />
        <Skeleton height="96px" borderRadius="xl" />
      </VStack>
    );
  }
  if (roles.length === 0) {
    return (
      <NoDataInfoBlock
        title="No custom roles yet"
        description="Write one when somebody needs a narrower slice of access than Admin, Member or Viewer gives them."
        icon={<ShieldCheck />}
      />
    );
  }

  return (
    <VStack align="stretch" width="full" gap={4}>
      {roles.map((role) => {
        const input = { assignments: assignments ?? [], customRoleId: role.id };
        return (
          <CustomRoleCard
            key={role.id}
            role={role}
            canManage={canManage}
            holders={holdersOfCustomRole(input)}
            scopes={scopesOfCustomRole(input)}
            people={assignments ? peopleHoldingCustomRole(input) : null}
            onOpenDetail={() => onOpenDetail(role)}
            onEdit={() => onEdit(role)}
            onDelete={() => onDelete(role)}
          />
        );
      })}
    </VStack>
  );
}

function SectionHeading({
  title,
  hint,
  right,
}: {
  title: string;
  hint: string;
  right?: ReactNode;
}) {
  return (
    <HStack width="full" align="start">
      <Box>
        <Heading as="h3">{title}</Heading>
        <Text color="fg.muted" fontSize="sm">
          {hint}
        </Text>
      </Box>
      <Spacer />
      {right}
    </HStack>
  );
}

/** A read that failed, said in place rather than as an empty section. */
function SectionErrorNotice({ title }: { title: string }) {
  return (
    <Alert.Root status="error" data-testid="section-error-notice">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{title}</Alert.Title>
      </Alert.Content>
    </Alert.Root>
  );
}
