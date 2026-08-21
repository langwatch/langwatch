import { Heading, Tabs, VStack } from "@chakra-ui/react";
import { useState } from "react";

import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { LoadingScreen } from "~/components/LoadingScreen";
import type { AiToolEntry } from "~/components/me/tiles/types";
import { PermissionRequiredNotice } from "~/components/PermissionRequiredNotice";
import { AiToolEntryDrawer } from "~/components/settings/governance/AiToolEntryDrawer";
import { IngestionTemplatesEditor } from "~/components/settings/governance/IngestionTemplatesEditor";
import { ToolCatalogEditor } from "~/components/settings/governance/ToolCatalogEditor";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

/**
 * Admin AI Tool Tiles editor - Phase 7 B6+B9 wired surface.
 *
 * Two tabs per `ingestion-templates-catalog.feature` @admin-readonly
 * scenario:
 *   - Tool Tiles: AiToolEntry catalog (drag-reorder + add/edit). Coding-
 *     assistant tiles also carry the CLI path policy (gateway / OTLP
 *     direct), which used to live in a separate "CLI Paths" tab.
 *   - Ingestion Templates: READ-ONLY catalog of platform-published
 *     IngestionTemplate rows. Admin sees what's shipped + 'View OTTL' for
 *     transparency. No edit/disable/fork v1; admin authoring lands v2.
 *
 * Both tabs read through `aiTools:manage`, which is the catalog's own grant.
 * The page opens on `governance:view` like the rest of Governance, so a
 * delegated viewer arrives here from the section navigation and is told which
 * grant the catalog needs rather than being refused the whole page.
 */
function ToolCatalogPage() {
  const { organization, hasAnyPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const canManageCatalog = hasAnyPermission("aiTools:manage");

  const [drawerState, setDrawerState] = useState<
    | { mode: "create"; type: AiToolEntry["type"] }
    | { mode: "edit"; entry: AiToolEntry }
    | null
  >(null);

  if (!organization) {
    return <LoadingScreen />;
  }

  if (!canManageCatalog) {
    return (
      <GovernanceLayout pageTitle="Tool Tiles · Governance · LangWatch">
        <VStack align="stretch" gap={6} width="full">
          <ToolCatalogHeading />
          <PermissionRequiredNotice
            permission="aiTools:manage"
            detail="The tiles and the ingestion templates stay hidden until then."
          />
        </VStack>
      </GovernanceLayout>
    );
  }

  return (
    <GovernanceLayout pageTitle="Tool Tiles · Governance · LangWatch">
      <VStack align="stretch" gap={6} width="full">
        <ToolCatalogHeading />

        <Tabs.Root
          variant="line"
          defaultValue="tool-tiles"
          // lazyMount only (no unmountOnExit): the Ingestion Templates tab
          // renders drawers (EditOttlDrawer, CreateTemplateDrawer) with
          // their own local form state (OTTL statements, new-template
          // fields). Unmounting that tab while a drawer is open would
          // destroy in-progress edits, so we avoid unmountOnExit for the
          // whole Root and only skip mounting tabs that were never opened.
          lazyMount
        >
          <Tabs.List>
            <Tabs.Trigger
              value="tool-tiles"
              color="fg.muted"
              _selected={{ color: "fg", fontWeight: "semibold" }}
            >
              Tool Tiles
            </Tabs.Trigger>
            <Tabs.Trigger
              value="ingestion-templates"
              color="fg.muted"
              _selected={{ color: "fg", fontWeight: "semibold" }}
            >
              Ingestion Templates
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="tool-tiles" paddingTop={4}>
            <ToolCatalogEditor
              organizationId={organization.id}
              onAddTile={(type) => setDrawerState({ mode: "create", type })}
              onEditTile={(entry) => setDrawerState({ mode: "edit", entry })}
            />
          </Tabs.Content>
          <Tabs.Content value="ingestion-templates" paddingTop={4}>
            <IngestionTemplatesEditor organizationId={organization.id} />
          </Tabs.Content>
        </Tabs.Root>
      </VStack>

      <AiToolEntryDrawer
        organizationId={organization.id}
        state={drawerState}
        onClose={() => setDrawerState(null)}
      />
    </GovernanceLayout>
  );
}

function ToolCatalogHeading() {
  return <Heading size="md">AI Tool Tiles</Heading>;
}

export default withFeatureFlagGuard("release_ui_ai_governance_enabled", {
  bypassOnboardingRedirect: true,
})(
  withPermissionGuard("governance:view", {
    bypassOnboardingRedirect: true,
  })(ToolCatalogPage),
);
