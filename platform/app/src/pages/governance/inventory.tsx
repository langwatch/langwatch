import { Tabs } from "@chakra-ui/react";
import { useSearchParams } from "react-router";

import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { IngestionSourcesPanel } from "@ee/governance/dashboard/pages/ingestion-sources";
import { ToolCatalogPanel } from "./tool-catalog";

/**
 * Inventory — one roof for "what AI tools does this organization run".
 *
 * Two tabs, addressed by `?tab=` so either view is linkable:
 *   - Sources: the ingestion sources the org streams governance data from
 *     (the page that used to own the whole "Catalog" nav item).
 *   - Catalog: the AI tool tile publisher (the former Tool Tiles page).
 *
 * The panels are the previous pages' bodies, unchanged; this shell owns the
 * layout, the section navigation highlight and the single permission gate.
 * Deep links to the old addresses redirect here with the matching tab.
 */
function InventoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Default to Sources: that is what the sidebar's old Catalog item showed,
  // so readers who follow muscle memory land where they expect.
  const tab = searchParams.get("tab") === "catalog" ? "catalog" : "sources";

  return (
    <GovernanceLayout pageTitle="Inventory · Governance · LangWatch">
      <Tabs.Root
        variant="line"
        value={tab}
        onValueChange={(event) => setSearchParams({ tab: event.value })}
        lazyMount
      >
        <Tabs.List>
          <Tabs.Trigger
            value="sources"
            color="fg.muted"
            _selected={{ color: "fg", fontWeight: "semibold" }}
          >
            Sources
          </Tabs.Trigger>
          <Tabs.Trigger
            value="catalog"
            color="fg.muted"
            _selected={{ color: "fg", fontWeight: "semibold" }}
          >
            Catalog
          </Tabs.Trigger>
        </Tabs.List>
        {/* lazyMount only (no unmountOnExit): both tabs hold drawers and
            editors with local draft state that must survive tab hops. */}
        <Tabs.Content value="sources" paddingTop={4}>
          <IngestionSourcesPanel />
        </Tabs.Content>
        <Tabs.Content value="catalog" paddingTop={4}>
          <ToolCatalogPanel />
        </Tabs.Content>
      </Tabs.Root>
    </GovernanceLayout>
  );
}

export default withFeatureFlagGuard("release_ui_ai_governance_enabled", {
  bypassOnboardingRedirect: true,
})(
  withPermissionGuard("governance:view", {
    bypassOnboardingRedirect: true,
  })(InventoryPage),
);
