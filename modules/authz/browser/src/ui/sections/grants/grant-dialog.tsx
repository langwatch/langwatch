// Granting a role to a member or a group somewhere, or changing the role of a grant.
// It fetches nothing: the choices and the reader's standing arrive as props, and the saving is
// handed back. The dialog only greys out roles it can tell are beyond the reader.
// specs/rbac/roles-and-access-ui.feature

import type { GrantScopeType } from "@langwatch/authz-contract";
import { Dialog } from "@langwatch/design-system/dialog";
import { Field, Input, NativeSelect, Text, VStack } from "@langwatch/design-system/primitives";
import { ScopeChipPicker, type ScopeTriadEntry } from "@langwatch/design-system/scope-chip-picker";
import { type FormEvent, type Ref, useId, useRef, useState } from "react";

import type { GrantScope, GrantDraft } from "../../../model/grants/grant-draft.ts";
import {
  expiryFromDay,
  grantPrincipalText,
  grantRoleOptions,
  grantScopeText,
  type GrantRow,
  permissionsBeyondReader,
  rolePermissionsAt,
  SCOPE_TYPE_OF_TIER,
} from "../../../model/grants/grants.ts";

export type { GrantScope, GrantDraft };

export type GrantDialogProps = {
  organizationId: string;
  /** The grant whose role changes, or null when a new grant is being made. */
  editing: GrantRow | null;
  /** The organization's own roles; the built-in ones are always offered. */
  roles: readonly { id: string; name: string; permissions: readonly string[] }[];
  members: readonly { id: string; name?: string | null; email?: string | null }[];
  groups: readonly { id: string; name: string }[];
  structure: {
    organizationName?: string | undefined;
    teams: readonly { id: string; name: string }[];
    projects: readonly { id: string; name: string; teamId: string }[];
  };
  /** What the reader holds at the chosen scope; undefined until known, so no role is greyed out. */
  heldPermissions: readonly string[] | undefined;
  isSaving: boolean;
  /** Fired when the reader picks another scope, so the consumer can fetch their standing there. */
  onScopeChange: (scope: GrantScope) => void;
  onCreate: (draft: GrantDraft) => void;
  onChangeRole: (change: { grantId: string; roleId: string }) => void;
  onClose: () => void;
};

function PrincipalField({
  ref,
  value,
  onChange,
  invalid,
  members,
  groups,
}: {
  ref: Ref<HTMLSelectElement>;
  value: string;
  onChange: (next: string) => void;
  invalid: boolean;
  members: GrantDialogProps["members"];
  groups: GrantDialogProps["groups"];
}) {
  return (
    <Field.Root required invalid={invalid}>
      <Field.Label>Who</Field.Label>
      <NativeSelect.Root>
        <NativeSelect.Field
          ref={ref}
          aria-label="Who"
          data-testid="grant-who"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          <option value="">Choose a member or a group</option>
          <optgroup label="Members">
            {members.map((member) => (
              <option key={member.id} value={`user:${member.id}`}>
                {member.name ?? member.email ?? member.id}
              </option>
            ))}
          </optgroup>
          <optgroup label="Groups">
            {groups.map((group) => (
              <option key={group.id} value={`group:${group.id}`}>
                {group.name}
              </option>
            ))}
          </optgroup>
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
      <Field.ErrorText>Choose a member or a group.</Field.ErrorText>
    </Field.Root>
  );
}

function RoleField({
  ref,
  value,
  onChange,
  invalid,
  roles,
  isBeyondReader,
}: {
  ref: Ref<HTMLSelectElement>;
  value: string;
  onChange: (next: string) => void;
  invalid: boolean;
  roles: GrantDialogProps["roles"];
  isBeyondReader: (roleId: string) => boolean;
}) {
  return (
    <Field.Root required invalid={invalid}>
      <Field.Label>Role</Field.Label>
      <NativeSelect.Root>
        <NativeSelect.Field
          ref={ref}
          aria-label="Role"
          data-testid="grant-role"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          <option value="">Choose a role</option>
          {grantRoleOptions({ customRoles: roles }).map((role) => {
            const beyond = isBeyondReader(role.id);
            return (
              <option key={role.id} value={role.id} disabled={beyond}>
                {beyond ? `${role.name} (more access than you have)` : role.name}
              </option>
            );
          })}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
      <Field.ErrorText>Choose a role.</Field.ErrorText>
    </Field.Root>
  );
}

/** Mounted only while open, so each opening starts from the grant it is about. */
export function GrantDialog({
  organizationId,
  editing,
  roles,
  members,
  groups,
  structure,
  heldPermissions,
  isSaving,
  onScopeChange,
  onCreate,
  onChangeRole,
  onClose,
}: GrantDialogProps) {
  const [principal, setPrincipal] = useState("");
  const [roleId, setRoleId] = useState(editing?.role.id ?? "");
  const [scope, setScope] = useState<ScopeTriadEntry[]>([
    { scopeType: "ORGANIZATION", scopeId: organizationId },
  ]);
  const [day, setDay] = useState("");
  const [attempted, setAttempted] = useState(false);
  const formId = useId();
  const principalRef = useRef<HTMLSelectElement>(null);
  const roleRef = useRef<HTMLSelectElement>(null);

  const scopeType: GrantScopeType = editing?.scope.type ?? SCOPE_TYPE_OF_TIER[scope[0]!.scopeType];
  const scopeId = editing?.scope.id ?? scope[0]!.scopeId;

  // A team's standing cannot be asked for, so no role is greyed out there.
  const isBeyondReader = (candidate: string) => {
    const requested = rolePermissionsAt({ roleId: candidate, scopeType, customRoles: roles });
    if (!requested || !heldPermissions || scopeType === "team") return false;
    return permissionsBeyondReader({ requested, held: heldPermissions }).length > 0;
  };

  const principalMissing = !editing && !principal;
  const roleMissing = !roleId;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving) return;
    setAttempted(true);
    if (principalMissing) {
      principalRef.current?.focus();
      return;
    }
    if (roleMissing) {
      roleRef.current?.focus();
      return;
    }
    if (editing) {
      onChangeRole({ grantId: editing.id, roleId });
      return;
    }
    const [type, id] = principal.split(":");
    const expiresAt = expiryFromDay(day);
    onCreate({
      principal: { type: type === "group" ? "group" : "user", id: id ?? "" },
      roleId,
      scope: { type: scopeType, id: scopeId },
      ...(expiresAt ? { expiresAt } : {}),
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={editing ? "Change role" : "Grant a role"}
      size="md"
      primaryAction={{
        label: editing ? "Change role" : "Grant role",
        type: "submit",
        form: formId,
        loading: isSaving,
        "data-testid": "grant-submit",
      }}
    >
      <form id={formId} noValidate onSubmit={submit}>
        <VStack align="stretch" gap={5}>
          {editing ? (
            <Text fontSize="sm">
              {grantPrincipalText(editing.principal)} on {grantScopeText(editing.scope)}
            </Text>
          ) : (
            <PrincipalField
              ref={principalRef}
              value={principal}
              onChange={setPrincipal}
              invalid={attempted && principalMissing}
              members={members}
              groups={groups}
            />
          )}

          <RoleField
            ref={roleRef}
            value={roleId}
            onChange={setRoleId}
            invalid={attempted && roleMissing}
            roles={roles}
            isBeyondReader={isBeyondReader}
          />

          {!editing && (
            <>
              <ScopeChipPicker
                value={scope}
                onChange={(next) => {
                  const [first] = next;
                  if (!first) return;
                  setScope(next);
                  onScopeChange({ type: SCOPE_TYPE_OF_TIER[first.scopeType], id: first.scopeId });
                }}
                organizationId={organizationId}
                {...(structure.organizationName
                  ? { organizationName: structure.organizationName }
                  : {})}
                availableTeams={[...structure.teams]}
                availableProjects={[...structure.projects]}
                label="Where"
                variant="single-select"
                showSummary={false}
              />
              <Field.Root>
                <Field.Label>Ends on</Field.Label>
                <Input
                  type="date"
                  aria-label="Ends on"
                  value={day}
                  onChange={(event) => setDay(event.currentTarget.value)}
                />
                <Field.HelperText>Leave empty for access that does not end.</Field.HelperText>
              </Field.Root>
            </>
          )}
        </VStack>
      </form>
    </Dialog>
  );
}
