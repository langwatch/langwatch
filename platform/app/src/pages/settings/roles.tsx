import { Alert, Box, Spinner, Tabs, Text, VStack } from "@chakra-ui/react";
import { useSearchParams } from "react-router";
import { RoleAssignmentsPanel } from "~/components/access/RoleAssignmentsPanel";
import { RolesPanel } from "~/components/access/RolesPanel";
import { ROLE_ASSIGNMENT_WORDS } from "~/components/access/roleAssignments";
import { useDrawer } from "~/hooks/useDrawer";
import SettingsLayout from "../../components/SettingsLayout";
import { SettingsPageHeader } from "../../components/settings/SettingsPageHeader";
import { ContactSalesBlock } from "../../components/subscription/ContactSalesBlock";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import { useActivePlan } from "../../hooks/useActivePlan";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";

/**
 * Roles: what a role can do, and who holds one.
 *
 * Two tabs where there were two nav entries. The second used to be a page
 * called Role Bindings, which asked a reader to learn a word only this
 * codebase says and put it a whole navigation entry away from the roles it
 * lists. The engine goes on calling them bindings (ADR-092); the screen calls
 * them role assignments, the way every identity product a customer has used
 * does.
 */
function RolesSettings() {
  const { organization, hasPermission } = useOrganizationTeamProject();
  const { isEnterprise, isLoading: isPlanLoading } = useActivePlan();

  if (!organization || isPlanLoading) {
    return (
      <SettingsLayout>
        <VStack align="center" justify="center" width="full" height="200px">
          <Spinner />
        </VStack>
      </SettingsLayout>
    );
  }

  if (!isEnterprise) {
    return (
      <SettingsLayout>
        <VStack gap={6} width="full" align="start">
          <Alert.Root status="info">
            <Alert.Indicator />
            <Alert.Content>
              {/* Sentence case, like the identical alert Groups draws. The
                  same lock spelled two ways is the same lock looking like two
                  products. */}
              <Alert.Title>Enterprise feature</Alert.Title>
              <Alert.Description>
                Custom roles are available on Enterprise plans. Contact sales to
                upgrade.
              </Alert.Description>
            </Alert.Content>
          </Alert.Root>
          <Box width="full">
            <ContactSalesBlock />
          </Box>
        </VStack>
      </SettingsLayout>
    );
  }

  return (
    <SettingsLayout>
      <RolesTabs
        organizationId={organization.id}
        organizationName={organization.name}
        canManage={hasPermission("organization:manage")}
        canReadAuditLog={hasPermission("auditLog:view")}
      />
    </SettingsLayout>
  );
}

export default withPermissionGuard("organization:manage", {
  layoutComponent: SettingsLayout,
})(RolesSettings);

function RolesTabs({
  organizationId,
  organizationName,
  canManage,
  canReadAuditLog,
}: {
  organizationId: string;
  organizationName: string;
  canManage: boolean;
  canReadAuditLog: boolean;
}) {
  // Which tab is open lives in the address, so the old Role Bindings
  // bookmark can forward straight onto the assignments rather than dropping
  // its reader on the definitions.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab =
    searchParams.get("tab") === "assignments" ? "assignments" : "roles";
  const selectTab = (next: string) =>
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        // Roles is the default, so it stays out of the address entirely.
        if (next === "assignments") params.set("tab", next);
        else params.delete("tab");
        return params;
      },
      { replace: true },
    );
  const { openDrawer } = useDrawer();

  return (
    <VStack align="start" width="full" gap={6}>
      <SettingsPageHeader
        title="Roles"
        description="What a role can do, and who holds one."
      />

      <Tabs.Root
        value={tab}
        onValueChange={(event) => selectTab(event.value)}
        colorPalette="blue"
        width="full"
      >
        <Tabs.List marginBottom={6}>
          <Tabs.Trigger value="roles">Roles</Tabs.Trigger>
          <Tabs.Trigger value="assignments">
            {ROLE_ASSIGNMENT_WORDS.plural}
          </Tabs.Trigger>
        </Tabs.List>

        {/* Only the tab being read is mounted. The tab that is not open must
            not hold a read of every role assignment in the organization open
            behind it, nor offer its actions to somebody looking at the
            other one. */}
        <Tabs.Content value="assignments">
          {tab === "assignments" && (
            <RoleAssignmentsPanel
              organizationId={organizationId}
              onOpenPerson={(userId) => openDrawer("person", { userId })}
            />
          )}
        </Tabs.Content>

        <Tabs.Content value="roles">
          {tab === "roles" && (
            <RolesPanel
              organizationId={organizationId}
              organizationName={organizationName}
              canManage={canManage}
              canReadAuditLog={canReadAuditLog}
            />
          )}
        </Tabs.Content>
      </Tabs.Root>
    </VStack>
  );
}
