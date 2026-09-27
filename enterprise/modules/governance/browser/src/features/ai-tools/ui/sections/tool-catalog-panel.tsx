import { Tabs, VStack } from "@chakra-ui/react";
import type { AiToolEntry } from "@langwatch/enterprise-governance-contract";
import { useState } from "react";

import { useGovernanceScope } from "../../../../behavior/governance-session.ts";
import { LoadingScreen } from "../../../../ui/elements/loading-screen.tsx";
import { PermissionRequiredNotice } from "../../../../ui/elements/permission-required-notice.tsx";
import { AiToolEntryDrawer } from "./ai-tool-entry-drawer.tsx";
import { IngestionTemplatesEditor } from "./ingestion-templates-editor.tsx";
import { ToolCatalogEditor } from "./tool-catalog-editor.tsx";
/** Two-tab catalog pane: Tool Tiles (editable) and Ingestion Templates (read-only). */
function CatalogTabs({
  organizationId,
  onAddTile,
  onEditTile,
}: {
  organizationId: string;
  onAddTile: (type: AiToolEntry["type"]) => void;
  onEditTile: (entry: AiToolEntry) => void;
}) {
  return (
    <Tabs.Root
      variant="line"
      defaultValue="tool-tiles"
      // lazyMount only (no unmountOnExit): the Ingestion Templates tab
      // renders drawers with their own local form state. Unmounting that
      // tab while a drawer is open would destroy in-progress edits, so we
      // skip mounting tabs that were never opened instead.
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
          organizationId={organizationId}
          onAddTile={onAddTile}
          onEditTile={onEditTile}
        />
      </Tabs.Content>
      <Tabs.Content value="ingestion-templates" paddingTop={4}>
        <IngestionTemplatesEditor organizationId={organizationId} />
      </Tabs.Content>
    </Tabs.Root>
  );
}

/** Catalog pane with tile editor, ingestion templates, and aiTools:manage grant check. */
export function ToolCatalogPanel() {
  const { organization, hasAnyPermission } = useGovernanceScope();
  const canManageCatalog = hasAnyPermission("aiTools:manage");

  const [drawerState, setDrawerState] = useState<
    { mode: "create"; type: AiToolEntry["type"] } | { mode: "edit"; entry: AiToolEntry } | null
  >(null);

  if (!organization) {
    return <LoadingScreen />;
  }

  if (!canManageCatalog) {
    return (
      <PermissionRequiredNotice
        permission="aiTools:manage"
        detail="The tiles and the ingestion templates stay hidden until then."
      />
    );
  }

  return (
    <VStack align="stretch" gap={6} width="full">
      <CatalogTabs
        organizationId={organization.id}
        onAddTile={(type) => setDrawerState({ mode: "create", type })}
        onEditTile={(entry) => setDrawerState({ mode: "edit", entry })}
      />

      <AiToolEntryDrawer
        organizationId={organization.id}
        state={drawerState}
        onClose={() => setDrawerState(null)}
      />
    </VStack>
  );
}
