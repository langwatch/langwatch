// Granting a role to a member or a group somewhere, or changing the role of a grant.
// The server refuses anything beyond the reader's own access; the dialog only greys
// out the roles it can already tell are. specs/rbac/roles-and-access-ui.feature

import { Button, Field, Input, NativeSelect, Text, VStack } from "@chakra-ui/react";
import { ScopeChipPicker, type ScopeTriadEntry } from "@langwatch/authz-browser-kit";
import type { GrantScopeType } from "@langwatch/authz-contract";
import { Dialog } from "@langwatch/design-system/dialog";
import { toDate } from "@langwatch/time";
import { useState } from "react";

import { authzApi } from "../../behavior/authz-api.ts";
import { useAuthzHost } from "../../model/authz-host.ts";
import {
  expiryFromDay,
  grantPrincipalText,
  grantRoleOptions,
  grantScopeText,
  type GrantRow,
  permissionsBeyondReader,
  rolePermissionsAt,
} from "../../model/grants.ts";

const SCOPE_OF_TIER = { ORGANIZATION: "organization", TEAM: "team", PROJECT: "project" } as const;

/** Mounted only while open, so each opening starts from the grant it is about. */
type GrantDialogProps = {
  organizationId: string;
  /** The grant whose role changes, or null when a new grant is being made. */
  editing: GrantRow | null;
  onClose: () => void;
};

export function GrantDialog({ organizationId, editing, onClose }: GrantDialogProps) {
  const host = useAuthzHost();
  const structure = host.organizationStructure();
  const utils = authzApi.useUtils();
  const [principal, setPrincipal] = useState("");
  const [roleId, setRoleId] = useState(editing?.role.id ?? "");
  const [scope, setScope] = useState<ScopeTriadEntry[]>([
    { scopeType: "ORGANIZATION", scopeId: organizationId },
  ]);
  const [day, setDay] = useState("");

  const scopeType: GrantScopeType = editing?.scope.type ?? SCOPE_OF_TIER[scope[0]!.scopeType];
  const scopeId = editing?.scope.id ?? scope[0]!.scopeId;
  const roles = authzApi.role.getAll.useQuery({ organizationId });
  const members = authzApi.organization.getAllOrganizationMembers.useQuery(
    { organizationId },
    { enabled: !editing },
  );
  const groups = authzApi.group.listAll.useQuery({ organizationId }, { enabled: !editing });
  // A team's standing cannot be asked for, so no role is greyed out there.
  const standing = authzApi.authz.effectivePermissions.useQuery(
    scopeType === "project" ? { projectId: scopeId } : { organizationId },
    { enabled: scopeType !== "team" },
  );

  const customRoles = roles.data ?? [];
  const isBeyondReader = (candidate: string) => {
    const requested = rolePermissionsAt({ roleId: candidate, scopeType, customRoles });
    if (!requested || !standing.data || scopeType === "team") return false;
    return permissionsBeyondReader({ requested, held: standing.data.permissions }).length > 0;
  };

  const onSaved = (title: string) => {
    void utils.authz.listGrants.invalidate();
    void utils.roleBinding.listForOrg.invalidate();
    host.succeeded({ title });
    onClose();
  };
  const createGrant = authzApi.authz.createGrant.useMutation({
    onSuccess: () => onSaved("Role granted"),
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't grant this role" }),
  });
  const changeGrantRole = authzApi.authz.changeGrantRole.useMutation({
    onSuccess: () => onSaved("Role changed"),
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't change this role" }),
  });

  const submit = () => {
    if (editing) {
      changeGrantRole.mutate({ organizationId, grantId: editing.id, roleId });
      return;
    }
    const [type, id] = principal.split(":");
    const expiresAt = expiryFromDay(day);
    createGrant.mutate({
      organizationId,
      grant: {
        principal: { type: type === "group" ? "group" : "user", id: id ?? "" },
        roleId,
        scope: { type: scopeType, id: scopeId },
        ...(expiresAt ? { expiresAt: toDate(expiresAt) } : {}),
      },
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
                    value={principal}
                    onChange={(event) => setPrincipal(event.currentTarget.value)}
                  >
                    <option value="">Choose a member or a group</option>
                    <optgroup label="Members">
                      {(members.data ?? []).map((member) => (
                        <option key={member.id} value={`user:${member.id}`}>
                          {member.name ?? member.email ?? member.id}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Groups">
                      {(groups.data ?? []).map((group) => (
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
                  value={roleId}
                  onChange={(event) => setRoleId(event.currentTarget.value)}
                >
                  <option value="">Choose a role</option>
                  {grantRoleOptions({ customRoles }).map((role) => {
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
                  onChange={(next) => next.length > 0 && setScope(next)}
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
            loading={createGrant.isPending || changeGrantRole.isPending}
            onClick={submit}
          >
            {editing ? "Change role" : "Grant role"}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
