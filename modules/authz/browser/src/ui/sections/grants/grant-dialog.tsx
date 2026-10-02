// Granting a role to a member or a group somewhere, or changing the role of a grant.
// It fetches nothing: the choices and the reader's standing arrive as props, and the saving is
// handed back. The dialog only greys out roles it can tell are beyond the reader.
// specs/rbac/roles-and-access-ui.feature

import type { GrantScopeType } from "@langwatch/authz-contract";
import { Dialog } from "@langwatch/design-system/dialog";
import {
  Button,
  Field,
  Input,
  NativeSelect,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { ScopeChipPicker, type ScopeTriadEntry } from "@langwatch/design-system/scope-chip-picker";
import { useState } from "react";

import type { GrantScope, GrantDraft } from "../../../model/grants/grant-draft.ts";
import {
  expiryFromDay,
  grantPrincipalText,
  grantRoleOptions,
  grantScopeText,
  type GrantRow,
  permissionsBeyondReader,
  rolePermissionsAt,
} from "../../../model/grants/grants.ts";

export type { GrantScope, GrantDraft };

const SCOPE_OF_TIER = { ORGANIZATION: "organization", TEAM: "team", PROJECT: "project" } as const;

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

  const scopeType: GrantScopeType = editing?.scope.type ?? SCOPE_OF_TIER[scope[0]!.scopeType];
  const scopeId = editing?.scope.id ?? scope[0]!.scopeId;

  // A team's standing cannot be asked for, so no role is greyed out there.
  const isBeyondReader = (candidate: string) => {
    const requested = rolePermissionsAt({ roleId: candidate, scopeType, customRoles: roles });
    if (!requested || !heldPermissions || scopeType === "team") return false;
    return permissionsBeyondReader({ requested, held: heldPermissions }).length > 0;
  };

  const submit = () => {
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
  const canSubmit = !!roleId && (!!editing || !!principal);

  return (
    <Dialog.Root open onOpenChange={(event) => !event.open && onClose()}>
      <Dialog.Content bg="bg" maxWidth="560px">
        <Dialog.Header>
          <Dialog.Title>{editing ? "Change role" : "Grant a role"}</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="stretch" gap={5}>
            {editing ? (
              <Text fontSize="sm">
                {grantPrincipalText(editing.principal)} on {grantScopeText(editing.scope)}
              </Text>
            ) : (
              <Field.Root required>
                <Field.Label>Who</Field.Label>
                <NativeSelect.Root>
                  <NativeSelect.Field
                    aria-label="Who"
                    data-testid="grant-who"
                    value={principal}
                    onChange={(event) => setPrincipal(event.currentTarget.value)}
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
              </Field.Root>
            )}

            <Field.Root required>
              <Field.Label>Role</Field.Label>
              <NativeSelect.Root>
                <NativeSelect.Field
                  aria-label="Role"
                  data-testid="grant-role"
                  value={roleId}
                  onChange={(event) => setRoleId(event.currentTarget.value)}
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
            </Field.Root>

            {!editing && (
              <>
                <ScopeChipPicker
                  value={scope}
                  onChange={(next) => {
                    const [first] = next;
                    if (!first) return;
                    setScope(next);
                    onScopeChange({ type: SCOPE_OF_TIER[first.scopeType], id: first.scopeId });
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
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            colorPalette="blue"
            disabled={!canSubmit}
            data-testid="grant-submit"
            loading={isSaving}
            onClick={submit}
          >
            {editing ? "Change role" : "Grant role"}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
