import {
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
 * Admin AI Tool Catalog editor — Phase 7 B6+B9 wired surface.
 *
 * Reads + setEnabled wired to Sergey's `aiToolsCatalogRouter`
 * (commit `6c1be0cda`). Add/edit drawer (B7) + drag-reorder (B8) ship
 * in follow-up commits — clicking +Add tile or Edit currently opens
 * a placeholder until those land.
 */
export default function ToolCatalogPage() {
  const { project, organization } = useOrganizationTeamProject({
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
  if (!governancePreviewEnabled || !organization) {
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

        <ToolCatalogEditor
          organizationId={organization.id}
          onAddTile={(type) => setDrawerOpen({ mode: "create", type })}
          onEditTile={(entry) => setDrawerOpen({ mode: "edit", entry })}
        />
      </VStack>
    </SettingsLayout>
  );
}
