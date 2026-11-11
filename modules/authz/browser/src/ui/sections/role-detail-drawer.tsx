// What one role can do, opened from its row as the routed `roleDetail` drawer.
// Spec: specs/identity/org-access-cluster.feature

import { Drawer } from "@langwatch/design-system/drawer";
import { Box, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { ProviderScopeChips } from "@langwatch/design-system/provider-scope-chips";
import { format } from "@langwatch/time";
import type { ReactNode } from "react";

import {
  type BuiltinRoleEntry,
  type CustomRole,
  useRoleCatalogue,
} from "../../behavior/use-role-catalogue.ts";
import { useAuthzHost } from "../../model/authz-host.ts";
import type { ManagedGrant } from "../../model/managed-grant.ts";
import type { RoleDetailDrawerProps } from "../../model/role-detail-drawer.ts";
import {
  holdersOfCustomRole,
  peopleHoldingCustomRole,
  scopesOfCustomRole,
} from "../../model/role-holders.ts";
import { permissionsNeedingOrganizationScope } from "../../model/role-permissions.ts";
import { RoleHolderStrip } from "../blocks/role-holder-strip.tsx";
import { RolePermissionAreas } from "../blocks/role-permission-areas.tsx";
import { peopleLabel, permissionsLabel, RoleDot } from "../blocks/role-row.tsx";
import { PermissionTokenList } from "../elements/permission-token.tsx";
import { SectionEyebrow } from "../elements/section-eyebrow.tsx";

export function RoleDetailDrawer({ open = true, role }: RoleDetailDrawerProps) {
  const host = useAuthzHost();
  const organizationId = host.scope().organizationId ?? "";
  const catalogue = useRoleCatalogue({ organizationId });
  const close = () => host.closeOverlay();

  const builtin = catalogue.builtin.find((entry) => entry.key === role);
  if (builtin) {
    return (
      <Drawer
        open={open}
        onClose={close}
        size="sm"
        title={builtin.name}
        icon={<RoleDot palette={builtin.dot} />}
        titleContent={<DrawerTitle name={builtin.name} people={builtin.people} />}
        data-testid="role-detail-drawer"
      >
        <BuiltinRoleDetail entry={builtin} />
      </Drawer>
    );
  }

  const custom = catalogue.roles.data?.find((candidate) => candidate.id === role);
  if (custom) {
    const input = { assignments: catalogue.assignments ?? [], customRoleId: custom.id };
    const people = catalogue.assignments ? peopleHoldingCustomRole(input) : null;
    return (
      <Drawer
        open={open}
        onClose={close}
        size="sm"
        title={custom.name}
        icon={<RoleDot palette={null} />}
        titleContent={<DrawerTitle name={custom.name} people={people} />}
        data-testid="role-detail-drawer"
      >
        <CustomRoleDetail role={custom} assignments={catalogue.assignments} people={people} />
      </Drawer>
    );
  }

  return (
    <Drawer
      open={open}
      onClose={close}
      size="sm"
      title="Role"
      loading={catalogue.roles.isLoading}
      data-testid="role-detail-drawer"
    >
      <Text textStyle="bodySm" color="fg.muted">
        This link does not name a role here. Open one from Roles &amp; access.
      </Text>
    </Drawer>
  );
}

/** The name with how many hold it beside it, on one line; `title` stays the accessible name. */
function DrawerTitle({ name, people }: { name: string; people: number | null }) {
  return (
    <HStack gap={2} align="baseline" aria-hidden="true">
      <Text textStyle="cardTitle" color="fg">
        {name}
      </Text>
      <Text as="span" textStyle="caption" color="fg.muted">
        {people === null ? "Holders unavailable" : peopleLabel(people)}
      </Text>
    </HStack>
  );
}

function BuiltinRoleDetail({ entry }: { entry: BuiltinRoleEntry }) {
  return (
    <VStack align="stretch" gap={2.5}>
      <Text textStyle="bodySm" color="fg.muted">
        {entry.description}
      </Text>
      {entry.lead && <SectionEyebrow>{entry.lead}</SectionEyebrow>}
      <PermissionTokenList permissions={entry.headline} limit={entry.headline.length} readable />
      <SectionEyebrow>{permissionsLabel(entry.permissions.length)} in total</SectionEyebrow>
      <Divided>
        <RolePermissionAreas permissions={entry.permissions} />
      </Divided>
    </VStack>
  );
}

function CustomRoleDetail({
  role,
  assignments,
  people,
}: {
  role: CustomRole;
  assignments: readonly ManagedGrant[] | null;
  people: number | null;
}) {
  const input = { assignments: assignments ?? [], customRoleId: role.id };
  const scopes = scopesOfCustomRole(input);
  const inert = permissionsNeedingOrganizationScope(role.permissions);
  const assignedBelowOrganizationOnly =
    scopes.length > 0 &&
    !scopes.some((scope) => scope.scopeType === "ORGANIZATION") &&
    inert.length > 0;
  return (
    <VStack align="stretch" gap={2.5}>
      {role.description && (
        <Text textStyle="bodySm" color="fg.muted">
          {role.description}
        </Text>
      )}
      <SectionEyebrow>{permissionsLabel(role.permissions.length)} in total</SectionEyebrow>
      <Divided>
        <VStack align="stretch" gap={2}>
          <SectionEyebrow>In force on</SectionEyebrow>
          {scopes.length === 0 ? (
            <Text textStyle="bodySm" color="fg.muted">
              Nowhere yet. This role grants nothing until somebody is assigned it.
            </Text>
          ) : (
            <ProviderScopeChips
              scopes={scopes.map((scope) => ({
                scopeType: scope.scopeType,
                scopeId: scope.scopeId,
                ...(scope.scopeName ? { name: scope.scopeName } : {}),
              }))}
            />
          )}
          {assignedBelowOrganizationOnly && (
            <SectionEyebrow>
              {inert.length} {inert.length === 1 ? "permission takes" : "permissions take"} effect
              only where this role is assigned on the organization.
            </SectionEyebrow>
          )}
        </VStack>
      </Divided>
      <Divided>
        <VStack align="stretch" gap={2}>
          <SectionEyebrow>Held by</SectionEyebrow>
          <RoleHolderStrip holders={holdersOfCustomRole(input)} people={people} />
        </VStack>
      </Divided>
      <Divided>
        <RolePermissionAreas permissions={role.permissions} />
      </Divided>
      {role.createdAt && (
        <SectionEyebrow>Created {format(role.createdAt, "d MMM yyyy")}</SectionEyebrow>
      )}
    </VStack>
  );
}

function Divided({ children }: { children: ReactNode }) {
  return (
    <Box borderTopWidth="1px" borderColor="border" paddingTop={3} marginTop={2}>
      {children}
    </Box>
  );
}
