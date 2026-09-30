import { Box, Button, Text, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "~/components/gateway/ConfirmDialog";
import { Link } from "~/components/ui/link";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import type { RouterOutputs } from "~/utils/api";
import { api } from "~/utils/api";
import { SectionTitle } from "../settings/kit/SettingRow";
import { SectionErrorNotice } from "../settings/SectionErrorNotice";
import { Tooltip } from "../ui/tooltip";
import { BuiltinRoleCard, CustomRoleCard } from "./RoleCards";
import { RoleDetailDialog } from "./RoleDetailDialog";
import { RoleDialog } from "./RoleDialog";
import type { AssignmentRow } from "./roleHolders";
import {
  holdersOfCustomRole,
  peopleHoldingCustomRole,
  peopleHoldingRole,
  scopesOfCustomRole,
} from "./roleHolders";
import {
  BUILTIN_TIER_COPY,
  BUILTIN_TIERS,
  type BuiltinTier,
  builtinTierPermissions,
} from "./rolePermissions";

type CustomRole = RouterOutputs["role"]["getAll"][number];

interface CustomRolesProps {
  roles: CustomRole[] | undefined;
  readFailure: unknown;
  assignments: AssignmentRow[];
  assignmentsUnavailable: boolean;
  canManage: boolean;
  canReadAuditLog: boolean;
  onCreate: () => void;
  onEdit: (role: CustomRole) => void;
  onDelete: (role: CustomRole) => void;
  onOpenDetail: (role: CustomRole) => void;
}

/** The role name an assignment carries for each built-in tier. */
const TIER_ROLE_NAME: Record<BuiltinTier, string> = {
  admin: "ADMIN",
  member: "MEMBER",
  viewer: "VIEWER",
};

type OpenDialog =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "edit"; role: CustomRole }
  | {
      kind: "detail";
      title: string;
      description: string | null;
      permissions: string[];
    };

/**
 * What a role can do, and who holds one.
 *
 * Two questions, in the order an administrator actually asks them. First the
 * three roles every organization starts with, as the ladder they are, because
 * most of the time the answer is one of those and the reader can stop reading.
 * Then the roles this organization wrote for itself, each carrying what a
 * reader needs to judge it: what it grants, where it is in force, who holds it.
 *
 * Nothing on this page is prose kept in step by hand. The built-in permission
 * sets come from the engine's own declaration, and the counts, the scopes and
 * the holders are folded out of the assignments themselves — so a page that
 * says "12 people" is reporting rather than claiming.
 */
export function RolesPanel({
  organizationId,
  organizationName,
  canManage,
  canReadAuditLog,
}: {
  organizationId: string;
  organizationName?: string;
  canManage: boolean;
  canReadAuditLog: boolean;
}) {
  const state = useRolesPanel(organizationId);

  return (
    <VStack align="stretch" width="full" gap={8}>
      <PredefinedRoles
        assignments={state.assignmentRows}
        countsPending={state.countsPending}
        readFailure={
          state.assignmentsUnavailable ? state.assignments.error : null
        }
        onOpenDetail={state.openBuiltinDetail}
      />
      <CustomRoles
        roles={state.roles.data}
        readFailure={state.roles.isError ? state.roles.error : null}
        assignments={state.assignmentRows}
        assignmentsUnavailable={state.assignmentsUnavailable}
        canManage={canManage}
        canReadAuditLog={canReadAuditLog}
        onCreate={() => state.setDialog({ kind: "create" })}
        onEdit={(role) => state.setDialog({ kind: "edit", role })}
        onDelete={state.setRoleToDelete}
        onOpenDetail={state.openCustomDetail}
      />
      <RoleDialogs
        {...state}
        organizationId={organizationId}
        organizationName={organizationName}
      />
    </VStack>
  );
}

function useRolesPanel(organizationId: string) {
  const [dialog, setDialog] = useState<OpenDialog>({ kind: "none" });
  const [roleToDelete, setRoleToDelete] = useState<CustomRole | null>(null);

  const apiContext = api.useUtils();
  const roles = api.role.getAll.useQuery({ organizationId });
  const assignments = api.roleBinding.listForOrg.useQuery(
    { organizationId },
    { enabled: !!organizationId },
  );

  const assignmentRows = useMemo<AssignmentRow[]>(
    () => assignments.data ?? [],
    [assignments.data],
  );
  // The assignments are a second read, so losing them costs the counts and the
  // holders, never the roles. `null` is what a card renders as "this could not
  // be worked out", which is not the same claim as zero.
  const assignmentsUnavailable = assignments.isError;
  const countsPending = assignments.isLoading || assignmentsUnavailable;

  const deleteRole = api.role.delete.useMutation({
    onSuccess: () => {
      void apiContext.role.getAll.invalidate();
      void apiContext.roleBinding.listForOrg.invalidate();
      toaster.create({ title: "Role deleted", type: "success" });
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't delete this role" }),
  });

  const openBuiltinDetail = (tier: BuiltinTier) =>
    setDialog({
      kind: "detail",
      title: BUILTIN_TIER_COPY[tier].name,
      description: BUILTIN_TIER_COPY[tier].summary,
      permissions: builtinTierPermissions(tier),
    });
  const openCustomDetail = (role: CustomRole) =>
    setDialog({
      kind: "detail",
      title: role.name,
      description: role.description,
      permissions: role.permissions,
    });

  return {
    assignmentRows,
    assignments,
    assignmentsUnavailable,
    countsPending,
    deleteRole,
    dialog,
    openBuiltinDetail,
    openCustomDetail,
    roleToDelete,
    roles,
    setDialog,
    setRoleToDelete,
  };
}

function RoleDialogs({
  organizationId,
  organizationName,
  dialog,
  roleToDelete,
  deleteRole,
  setDialog,
  setRoleToDelete,
}: ReturnType<typeof useRolesPanel> & {
  organizationId: string;
  organizationName?: string;
}) {
  const closeDialog = () => setDialog({ kind: "none" });

  return (
    <>
      <RoleDialog
        open={dialog.kind === "create" || dialog.kind === "edit"}
        organizationId={organizationId}
        organizationName={organizationName}
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
        message={`Everyone holding "${
          roleToDelete?.name ?? ""
        }" loses what it grants them. This cannot be undone.`}
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
    </>
  );
}

/**
 * The three roles every organization starts with.
 *
 * A failed assignments read lands here rather than swallowing the section: the
 * roles are still true and still worth reading, so they are still drawn, and
 * only the counts admit to not knowing.
 */
function PredefinedRoles({
  assignments,
  countsPending,
  readFailure,
  onOpenDetail,
}: {
  assignments: AssignmentRow[];
  countsPending: boolean;
  readFailure: unknown;
  onOpenDetail: (tier: BuiltinTier) => void;
}) {
  return (
    <VStack align="stretch" width="full" gap={4}>
      {/* Section headers come from the kit, so this page spells them the
          way Authentication, Directory and Access do. */}
      <SectionTitle
        title="Predefined roles"
        hint="Three roles cover most teams. They cannot be changed or deleted."
      />

      <SectionErrorNotice
        error={readFailure}
        fallbackTitle="Couldn't work out who holds each role"
      />

      <Box
        width="full"
        display="grid"
        gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))"
        gap={4}
      >
        {BUILTIN_TIERS.map((tier) => (
          <BuiltinRoleCard
            key={tier}
            tier={tier}
            people={
              countsPending
                ? null
                : peopleHoldingRole({
                    assignments,
                    tier: TIER_ROLE_NAME[tier],
                  })
            }
            onOpenDetail={() => onOpenDetail(tier)}
          />
        ))}
      </Box>
    </VStack>
  );
}

/** The roles this organization wrote for itself. */
function CustomRoles({
  roles,
  readFailure,
  assignments,
  assignmentsUnavailable,
  canManage,
  canReadAuditLog,
  onCreate,
  onEdit,
  onDelete,
  onOpenDetail,
}: CustomRolesProps) {
  return (
    <VStack align="stretch" width="full" gap={4}>
      <SectionTitle
        title="Custom roles"
        hint="Scoped grants for people who need one thing and nothing else."
        right={
          <Tooltip
            content="You need permission to manage this organization to write a role."
            disabled={canManage}
          >
            <Button size="sm" onClick={onCreate} disabled={!canManage}>
              <Plus size={14} aria-hidden />
              New role
            </Button>
          </Tooltip>
        }
      />

      <CustomRolesContent
        roles={roles}
        readFailure={readFailure}
        assignments={assignments}
        assignmentsUnavailable={assignmentsUnavailable}
        canManage={canManage}
        onEdit={onEdit}
        onDelete={onDelete}
        onOpenDetail={onOpenDetail}
      />

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
  );
}

function CustomRolesContent(
  props: Omit<CustomRolesProps, "canReadAuditLog" | "onCreate">,
) {
  if (props.readFailure) {
    return (
      <SectionErrorNotice
        error={props.readFailure}
        fallbackTitle="Couldn't load your custom roles"
      />
    );
  }
  if (props.roles?.length === 0) {
    return (
      <Box
        width="full"
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="xl"
        padding={8}
      >
        <Text fontSize="sm" color="fg.muted">
          No custom roles yet. Write one when somebody needs a narrower slice of
          access than Admin, Member or Viewer gives them.
        </Text>
      </Box>
    );
  }

  return <CustomRoleCards {...props} />;
}

function CustomRoleCards({
  roles,
  assignments,
  assignmentsUnavailable,
  canManage,
  onEdit,
  onDelete,
  onOpenDetail,
}: Omit<CustomRolesProps, "canReadAuditLog" | "onCreate" | "readFailure">) {
  return (
    <VStack align="stretch" width="full" gap={4}>
      {roles?.map((role) => {
        const assignmentInput = { assignments, customRoleId: role.id };

        return (
          <CustomRoleCard
            key={role.id}
            role={role}
            canManage={canManage}
            holders={
              assignmentsUnavailable ? [] : holdersOfCustomRole(assignmentInput)
            }
            scopes={
              assignmentsUnavailable ? [] : scopesOfCustomRole(assignmentInput)
            }
            people={
              assignmentsUnavailable
                ? null
                : peopleHoldingCustomRole(assignmentInput)
            }
            onOpenDetail={() => onOpenDetail(role)}
            onEdit={() => onEdit(role)}
            onDelete={() => onDelete(role)}
          />
        );
      })}
    </VStack>
  );
}
