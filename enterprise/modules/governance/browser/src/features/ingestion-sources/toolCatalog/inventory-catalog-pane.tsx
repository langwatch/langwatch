// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AiToolEntry } from "@langwatch/enterprise-governance-contract";
import { useMemo } from "react";

import type { useAiToolCatalog } from "../../ai-tools/ui/sections/use-ai-tool-catalog.ts";
import { ToolCardMenu } from "./tool-card-menu";
import type { ToolCard } from "./tool-cards";
import type { ToolCatalogLayout } from "./tool-catalog-cards";
import { ToolCatalogTab } from "./tool-catalog-tab";

/** The Catalog pane wired to the page's registry read; the row menu only on real cards. */
export function InventoryCatalogPane({
  catalog,
  canManage,
  sampleActive,
  layout,
  onEdit,
}: {
  catalog: ReturnType<typeof useAiToolCatalog>;
  canManage: boolean;
  sampleActive: boolean;
  layout: ToolCatalogLayout;
  onEdit: (entry: AiToolEntry) => void;
}) {
  const entryById = useMemo(
    () => new Map(catalog.entries.map((entry) => [entry.id, entry])),
    [catalog.entries],
  );

  const renderActions = (card: ToolCard) => {
    const entry = entryById.get(card.id);
    if (!entry) return null;
    return (
      <ToolCardMenu
        card={card}
        onEdit={() => onEdit(entry)}
        onTogglePublished={() => catalog.setEnabled({ id: entry.id, enabled: !entry.enabled })}
        onRemove={() => catalog.setPendingDelete(entry)}
        isTogglePending={catalog.togglePendingId === entry.id}
      />
    );
  };

  return (
    <ToolCatalogTab
      canManage={canManage}
      tools={catalog.entries}
      isLoading={catalog.isLoading}
      error={catalog.error}
      sampleActive={sampleActive}
      layout={layout}
      renderActions={sampleActive ? undefined : renderActions}
    />
  );
}
