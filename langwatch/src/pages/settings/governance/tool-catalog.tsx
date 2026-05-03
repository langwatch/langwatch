import {
  Box,
  Heading,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";

import { LoadingScreen } from "~/components/LoadingScreen";
import { NotFoundScene } from "~/components/NotFoundScene";
import SettingsLayout from "~/components/SettingsLayout";
import { ToolCatalogEditor } from "~/components/settings/governance/ToolCatalogEditor";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

import type { AiToolEntry } from "~/components/me/tiles/types";

/**
 * Admin AI Tool Catalog editor — Phase 7 B6 scaffold.
 *
 * UI shell against mock data. Will wire to Sergey's
 * `api.aiTools.adminList` + `api.aiTools.create/update/setEnabled/reorder`
 * mutations in B9.
 *
 * Drawer for add/edit + drag-to-reorder land in B7+B8.
 */
export default function ToolCatalogPage() {
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const { enabled: governancePreviewEnabled, isLoading: ffLoading } =
    useFeatureFlag("release_ui_ai_governance_enabled", {
      projectId: project?.id,
    });

  // TODO(B7): drawer state will live here
  const [_drawerOpen, setDrawerOpen] = useState<
    | { mode: "create"; type: AiToolEntry["type"] }
    | { mode: "edit"; entry: AiToolEntry }
    | null
  >(null);

  if (ffLoading) {
    return <LoadingScreen />;
  }
  if (!governancePreviewEnabled) {
    return <NotFoundScene />;
  }

  return (
    <SettingsLayout>
      <VStack align="stretch" gap={6} width="full">
        <HStack alignItems="end">
          <VStack align="start" gap={0}>
            <Heading as="h2" size="lg">
              AI Tool Catalog
            </Heading>
            <Text color="fg.muted" fontSize="sm">
              The AI tools your team sees on their <code>/me</code> portal.
              Drag to reorder.
            </Text>
          </VStack>
          <Spacer />
        </HStack>

        <Box
          padding={3}
          borderWidth="1px"
          borderColor="orange.300"
          borderRadius="sm"
          backgroundColor="orange.50"
        >
          <Text fontSize="xs" color="orange.700">
            <strong>UI preview only.</strong> Backend persistence (Sergey's
            <code> aiToolsCatalogRouter</code>) ships in a follow-up commit.
            This page renders mock data; actions are no-ops until B9.
          </Text>
        </Box>

        <ToolCatalogEditor
          onAddTile={(type) => setDrawerOpen({ mode: "create", type })}
          onEditTile={(entry) => setDrawerOpen({ mode: "edit", entry })}
          onToggleEnabled={(entry) => {
            // TODO(B9): wire to api.aiTools.setEnabled mutation
            console.log("toggle enabled", entry.id);
          }}
        />
      </VStack>
    </SettingsLayout>
  );
}
