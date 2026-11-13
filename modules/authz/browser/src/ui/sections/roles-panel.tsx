// What a role can do and who holds one: the built-in roles as one boxed list, Billing
// last, then the organization's own roles in the same rows.
// Spec: specs/identity/org-access-cluster.feature

import { Link } from "@langwatch/browser-host/link";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import {
  Button,
  HStack,
  Skeleton,
  Spacer,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { SettingList } from "@langwatch/design-system/settings-card";
import { Plus } from "lucide-react";
import { useState, type ReactNode } from "react";

import { authzApi } from "../../behavior/authz-api.ts";
import { type CustomRole, useRoleCatalogue } from "../../behavior/use-role-catalogue.ts";
import { useAuthzHost } from "../../model/authz-host.ts";
import type { ManagedGrant } from "../../model/managed-grant.ts";
import { RoleDetailDrawerToken } from "../../model/role-detail-drawer.ts";
import { peopleHoldingCustomRole } from "../../model/role-holders.ts";
import { RoleRow } from "../blocks/role-row.tsx";
import { SectionErrorNotice } from "../elements/section-error-notice.tsx";
import { RoleDialog } from "./role-dialog.tsx";

type OpenDialog = { kind: "none" } | { kind: "create" } | { kind: "edit"; role: CustomRole };

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
  const [roleToDelete, setRoleToDelete] = useState<CustomRole | null>(null);

  const utils = authzApi.useUtils();
  const catalogue = useRoleCatalogue({ organizationId });
  const openRole = (role: string) => host.openOverlay(RoleDetailDrawerToken, { role });

  const deleteRole = authzApi.role.delete.useMutation({
    onSuccess: () => {
      void utils.role.getAll.invalidate();
      void utils.authz.listManagedGrants.invalidate();
      host.succeeded({ title: "Role deleted" });
    },
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't delete this role" }),
  });

  return (
    <VStack align="stretch" width="full" gap={3.5}>
      {catalogue.assignmentsUnavailable && (
        <SectionErrorNotice title="Couldn't work out who holds each role" />
      )}
      <SettingList variant="boxed" data-testid="builtin-roles">
        {catalogue.builtin.map((entry) => (
          <RoleRow
            key={entry.key}
            dot={entry.dot}
            name={entry.name}
            description={entry.description}
            people={entry.people}
            permissions={entry.permissions.length}
            action={<RowAction label="See what it can do" onClick={() => openRole(entry.key)} />}
            data-testid={`builtin-role-${entry.key}`}
          />
        ))}
      </SettingList>

      <HStack width="full" align="baseline" gap={2.5} marginTop={1.5}>
        <Text as="h3" textStyle="cardTitle" color="fg">
          Custom roles
        </Text>
        <Text textStyle="bodySm" color="fg.muted">
          Scoped grants for people who need one thing and nothing else.
        </Text>
        <Spacer />
        {canManage && (
          <Button
            size="xs"
            variant="outline"
            onClick={() => setDialog({ kind: "create" })}
            data-testid="authz-role-create"
          >
            <Plus size={12} aria-hidden />
            New role
          </Button>
        )}
      </HStack>

      {catalogue.roles.isError ? (
        <SectionErrorNotice title="Couldn't load your custom roles" />
      ) : (
        <CustomRoleRows
          roles={catalogue.roles.data}
          assignments={catalogue.assignments}
          canManage={canManage}
          onOpen={(role) => openRole(role.id)}
          onEdit={(role) => setDialog({ kind: "edit", role })}
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

      <RoleDialog
        open={dialog.kind === "create" || dialog.kind === "edit"}
        organizationId={organizationId}
        editing={dialog.kind === "edit" ? dialog.role : null}
        onClose={() => setDialog({ kind: "none" })}
        onDelete={
          dialog.kind === "edit"
            ? () => {
                setRoleToDelete(dialog.role);
                setDialog({ kind: "none" });
              }
            : void 0
        }
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

function RowAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      size="xs"
      variant="ghost"
      color="fg.muted"
      textStyle="caption"
      fontWeight="medium"
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

/** The organization's own roles; `assignments` is null when they could not be read. */
function CustomRoleRows({
  roles,
  assignments,
  canManage,
  onOpen,
  onEdit,
}: {
  roles: readonly CustomRole[] | undefined;
  assignments: readonly ManagedGrant[] | null;
  canManage: boolean;
  onOpen: (role: CustomRole) => void;
  onEdit: (role: CustomRole) => void;
}): ReactNode {
  if (!roles) {
    return (
      <VStack align="stretch" width="full" gap={2}>
        <Skeleton height="40px" borderRadius="lg" />
        <Skeleton height="40px" borderRadius="lg" />
      </VStack>
    );
  }
  if (roles.length === 0) {
    return (
      <NoDataInfoBlock
        size="line"
        title="No custom roles yet. Write one when somebody needs a narrower slice of access than Admin, Member or Viewer gives them."
      />
    );
  }

  return (
    <SettingList variant="boxed" data-testid="custom-roles">
      {roles.map((role) => (
        <RoleRow
          key={role.id}
          dot={null}
          name={role.name}
          description={role.description}
          people={
            assignments ? peopleHoldingCustomRole({ assignments, customRoleId: role.id }) : null
          }
          permissions={role.permissions.length}
          action={
            canManage ? (
              <RowAction label="Edit" onClick={() => onEdit(role)} />
            ) : (
              <RowAction label="See what it can do" onClick={() => onOpen(role)} />
            )
          }
          data-testid={`custom-role-${role.id}`}
        />
      ))}
    </SettingList>
  );
}
