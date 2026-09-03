import { Tabs, VStack } from "@chakra-ui/react";
import { useState } from "react";

import { LoadingScreen } from "../../../../ui/elements/loading-screen";
import type { AiToolEntry } from "../../model/ai-tool-tile";
import { PermissionRequiredNotice } from "../../../../ui/elements/permission-required-notice";
import { AiToolEntryDrawer } from "./ai-tool-entry-drawer";
import { IngestionTemplatesEditor } from "./ingestion-templates-editor";
import { ToolCatalogEditor } from "./tool-catalog-editor";
import { useGovernanceScope } from "../../../../behavior/governance-session";
/**
 * The two inner tabs of the Catalog pane, per the
 * `ingestion-templates-catalog.feature` @admin-readonly scenario:
 *   - Tool Tiles: AiToolEntry catalog (drag-reorder + add/edit). Coding-
 *     assistant tiles also carry the CLI path policy (gateway / OTLP
 *     direct), which used to live in a separate "CLI Paths" tab.
 *   - Ingestion Templates: READ-ONLY catalog of platform-published
 *     IngestionTemplate rows. Admin sees what's shipped + 'View OTTL' for
 *     transparency. No edit/disable/fork v1; admin authoring lands v2.
 *
 * The tile drawer lives with the panel, not here — this component only
 * reports which tile was asked for. That does not make the strip cheaper:
 * opening the drawer sets state on the panel, and the strip re-renders
 * with it (measured: one render before, two after). What it does buy is
 * that the strip is only ever re-rendered, never remounted, so the
 * selected tab and any open template drawer survive.
 */
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

/**
 * The tool-catalog editor body — the Catalog pane of the inventory page,
 * formerly the whole /governance/tool-catalog page. The composition is
 * unchanged from that page: it gates on the catalog's own grant, owns the
 * tile drawer's state, and delegates the tab strip to `CatalogTabs`.
 *
 * Both tabs read through `aiTools:manage`, the catalog's own grant. The
 * hosting page opens on `governance:view`, so a delegated viewer reaches
 * the pane and is told which grant the catalog needs — the notice renders
 * inside the pane, with the inventory tab strip still in place.
 */
export function ToolCatalogPanel() {
  const { organization, hasAnyPermission } = useGovernanceScope();
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
