import {
  Heading,
  HStack,
  Spacer,
  Tabs,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";

import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { LoadingScreen } from "~/components/LoadingScreen";
import { NotFoundScene } from "~/components/NotFoundScene";
import { AiToolEntryDrawer } from "~/components/settings/governance/AiToolEntryDrawer";
import { IngestionTemplatesEditor } from "~/components/settings/governance/IngestionTemplatesEditor";
import { ToolCatalogEditor } from "~/components/settings/governance/ToolCatalogEditor";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

import type { AiToolEntry } from "~/components/me/tiles/types";

/**
 * Admin AI Tool Catalog editor — Phase 7 B6+B9 wired surface.
 *
 * v1 ships two tabs per `ingestion-templates-catalog.feature` @admin-readonly
 * scenario:
 *   - Tool Tiles: existing AiToolEntry catalog (drag-reorder + add/edit)
 *   - Ingestion Templates: new READ-ONLY catalog of platform-published
 *     IngestionTemplate rows. Admin sees what's shipped + 'View OTTL' for
 *     transparency. No edit/disable/fork v1; admin authoring lands v2.
 */
function ToolCatalogPage() {
  const { project, organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const { enabled: governancePreviewEnabled, isLoading: ffLoading } =
    useFeatureFlag("release_ui_ai_governance_enabled", {
      projectId: project?.id,
    });

  const [drawerState, setDrawerState] = useState<
    | { mode: "create"; type: AiToolEntry["type"] }
    | { mode: "edit"; entry: AiToolEntry }
    | null
  >(null);

  if (ffLoading || !organization) {
    return <LoadingScreen />;
  }
  if (!governancePreviewEnabled) {
    return <NotFoundScene />;
  }

  return (
    <GovernanceLayout pageTitle="Tool Catalog · Governance · LangWatch">
      <VStack align="stretch" gap={6} width="full">
        <HStack alignItems="end">
          <VStack align="start" gap={0}>
            <Heading as="h2" size="lg">
              AI Tool Catalog
            </Heading>
            <Text color="fg.muted" fontSize="sm">
              Catalog rows your members see on their <code>/me</code> portal.
            </Text>
          </VStack>
          <Spacer />
        </HStack>

        <Tabs.Root variant="line" defaultValue="tool-tiles">
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
              onAddTile={(type) =>
                setDrawerState({ mode: "create", type })
              }
              onEditTile={(entry) =>
                setDrawerState({ mode: "edit", entry })
              }
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

export default withPermissionGuard("organization:manage", {
  bypassOnboardingRedirect: true,
})(ToolCatalogPage);
