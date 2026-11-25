// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { ContentTabs } from "@langwatch/design-system/content-tabs";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Badge, HStack, Spacer, VStack } from "@langwatch/design-system/primitives";
import { SECURITY_LAKE_SOURCE_TYPE } from "@langwatch/enterprise-governance-contract";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";

import { AiToolEntryDrawer } from "../../../features/ai-tools/ui/sections/ai-tool-entry-drawer.tsx";
import type { EnvironmentRow } from "../../../features/ingestion-sources/environments/discovered-environments.ts";
import {
  AddEnvironmentDialog,
  EnvironmentsTab,
  environmentRows,
} from "../../../features/ingestion-sources/environments/environments-tab.tsx";
import {
  NON_ENTERPRISE_INGESTION_SOURCE_CAP,
  type SourceType,
} from "../../../features/ingestion-sources/model/ingestion-source-catalog.ts";
import { inventorySummaryItems } from "../../../features/ingestion-sources/model/inventory-summary.ts";
import { SAMPLE_INGESTION_SOURCES } from "../../../features/ingestion-sources/sample-ingestion-sources.ts";
import { CatalogLayoutControl } from "../../../features/ingestion-sources/toolCatalog/catalog-layout-control.tsx";
import { InventoryCatalogPane } from "../../../features/ingestion-sources/toolCatalog/inventory-catalog-pane.tsx";
import { RemoveToolDialog } from "../../../features/ingestion-sources/toolCatalog/remove-tool-dialog.tsx";
import type { ToolCard } from "../../../features/ingestion-sources/toolCatalog/tool-cards.ts";
import { catalogCards } from "../../../features/ingestion-sources/toolCatalog/tool-catalog-tab.tsx";
import { AddIngestionSourceMenu } from "../../../features/ingestion-sources/ui/elements/add-ingestion-source-menu.tsx";
import { GovernanceSummaryBar } from "../../../ui/elements/governance-summary-bar.tsx";
import { SampleDataBanner, SampleDataToggle } from "../../../ui/elements/sample-data-controls.tsx";
import GovernanceLayout from "../../../ui/sections/governance-layout.tsx";
import { withGovernanceSection } from "../../../ui/sections/governance-section-gate.tsx";
import type { Source } from "./ingestion-source-forms.ts";
import { IngestionSourceList } from "./inventory/ingestion-source-list.tsx";
import { SourceComposerDrawer } from "./inventory/source-composer-drawer.tsx";
import { SecretModal } from "./inventory/source-secret-modal.tsx";
import {
  type InventoryTab,
  useIngestionSourcesPage,
  useInventoryTab,
} from "./inventory/use-inventory-page.ts";
import { SecurityLakeSection } from "./security-lake/security-lake-section.tsx";

/**
 * The Inventory page: header actions, summary strip, the Catalog, Environments and
 * Sources tabs, and the overlays. State and writes live in use-inventory-page.ts.
 */

function InventoryHeader() {
  return (
    <>
      <PageLayout.Heading>Inventory</PageLayout.Heading>
      <Badge colorPalette="purple" size="sm" variant="surface">
        Preview
      </Badge>
    </>
  );
}

/**
 * The id a per-row mutation is currently working on, so a row can show its own
 * spinner without every row spinning. Null while idle.
 */
function pendingId(mutation: {
  isPending: boolean;
  variables?: { id: string } | undefined;
}): string | null {
  return mutation.isPending ? (mutation.variables?.id ?? null) : null;
}

/** A tab label with the count beside it, once the count is known. */
/**
 * The inventory's tab shell.
 *
 * Counts sit on a tab only where that pane's own list has actually answered.
 * Environments is derived from the source list rather than read separately, so
 * it counts exactly when Sources counts and goes blank whenever Sources does —
 * one silence cannot be reported as a number on one tab and as nothing on the
 * tab beside it.
 */
function InventoryTabs({
  inventoryTab,
  selectInventoryTab,
  catalogCount,
  environmentCount,
  sourceCount,
  catalog,
  environments,
  sources,
}: {
  inventoryTab: InventoryTab;
  selectInventoryTab: (tab: string) => void;
  catalogCount?: number;
  environmentCount?: number;
  sourceCount?: number;
  catalog: ReactNode;
  environments: ReactNode;
  sources: ReactNode;
}) {
  return (
    <ContentTabs
      label="Inventory"
      value={inventoryTab}
      onValueChange={({ value }) => selectInventoryTab(value)}
      mount="active"
      items={[
        { value: "catalog", label: "Catalog", count: catalogCount, content: catalog },
        {
          value: "environments",
          label: "Environments",
          count: environmentCount,
          content: environments,
        },
        {
          value: "sources",
          label: "Sources",
          count: sourceCount,
          description: "Connections that send usage data to this inventory.",
          content: (
            <VStack align="stretch" gap={4} width="full">
              {sources}
            </VStack>
          ),
        },
      ]}
    />
  );
}

/** Security Lake sources have their own section; the generic edit would overwrite their config. */
function genericallyManagedSources<T extends { sourceType: string }>(
  sources: readonly T[] | undefined,
): T[] | undefined {
  return sources?.filter((source) => source.sourceType !== SECURITY_LAKE_SOURCE_TYPE);
}

/**
 * Everything under the Sources tab: the connectors header with the add control
 * an admin only sees with the manage grant, and the table itself.
 *
 * The load error is withheld while sample mode is on. A page showing invented
 * figures has already told the reader that nothing on it is real; an alert
 * about a read that failed underneath them is then noise about data they are
 * not looking at, and the banner above already says the screen is a mock-up.
 */
function InventorySourcesPane({ page }: { page: ReturnType<typeof useIngestionSourcesPage> }) {
  const { orgId, sourcesQuery, mutations } = page;
  const generic = genericallyManagedSources(sourcesQuery.data);
  const onlySecurityLake =
    !page.sample.active && generic?.length === 0 && (sourcesQuery.data?.length ?? 0) > 0;
  if (onlySecurityLake) return null;
  return (
    <IngestionSourceList
      canRead={page.canRead}
      isSample={page.sample.active}
      canManage={page.canManage && !page.sample.active}
      isLoading={!page.sample.active && sourcesQuery.isLoading}
      error={page.sample.active ? null : sourcesQuery.error}
      sources={page.sample.active ? SAMPLE_INGESTION_SOURCES : generic}
      rotatingId={pendingId(mutations.rotate)}
      archivingId={pendingId(mutations.archive)}
      onEdit={page.editSource}
      onRotate={(id) => mutations.rotate.mutate({ organizationId: orgId, id })}
      onArchive={(id) => mutations.archive.mutate({ organizationId: orgId, id })}
      createAction={
        page.canManage ? (
          <AddSourceControl
            isEnterprise={page.isEnterprise}
            sourceCount={sourcesQuery.data?.length ?? 0}
            onAdd={page.startComposer}
          />
        ) : undefined
      }
    />
  );
}

function InventorySecurityLakePane({ page }: { page: ReturnType<typeof useIngestionSourcesPage> }) {
  if (page.sample.active || !page.canRead) return null;
  return (
    <SecurityLakeSection
      organizationId={page.orgId}
      canManage={page.canManage}
      sources={page.sourcesQuery.data}
      onChanged={() => page.sourcesQuery.refetch()}
    />
  );
}

/**
 * Add environment, in one place.
 *
 * The header renders it and so does the empty state, and they must stay the
 * same control: an empty pane offering a differently-worded button is the
 * defect the one-create-flow rule exists for.
 */
function AddEnvironmentControl({ onAdd }: { onAdd: () => void }) {
  return (
    <PageLayout.HeaderButton onClick={onAdd}>
      <Plus size={14} /> Add environment
    </PageLayout.HeaderButton>
  );
}

/**
 * The actions at the top right of the page header, for the pane in view.
 *
 * They live in the header rather than inside each pane because they are page
 * actions — the section's rulebook puts every one of them in the same corner
 * on every screen, so a reader who found "See sample data" on Costs finds it
 * here without looking. At most one is solid: the single thing this pane is
 * for adding.
 */
function InventoryHeaderActions({
  page,
  inventoryTab,
}: {
  page: ReturnType<typeof useIngestionSourcesPage>;
  inventoryTab: InventoryTab;
}) {
  return (
    <HStack gap={2} flexShrink={0}>
      {inventoryTab === "catalog" && (
        <CatalogLayoutControl layout={page.catalogLayout} onChange={page.setCatalogLayout} />
      )}
      <SampleDataToggle active={page.sample.active} onToggle={page.sample.toggle} size="sm" />
      {page.canManage && (
        <AddSourceControl
          isEnterprise={page.isEnterprise}
          sourceCount={page.sourcesQuery.data?.length ?? 0}
          onAdd={page.startComposer}
        />
      )}
      {inventoryTab === "environments" && (
        <AddEnvironmentControl onAdd={() => page.setAddingEnvironment(true)} />
      )}
    </HStack>
  );
}

/**
 * The catalog's cards when the page may honestly count them, and null when it
 * may not — which is what draws the tab badge blank and the strip's em dash.
 *
 * THREE STATES, NOT TWO, and collapsing them is the bug this exists to stop.
 * Cards mean a counted catalog; an empty array means a catalog counted at
 * zero; null means the page has not been told. A reader without the registry
 * grant and a registry read still in flight both land on null, because "0
 * tools" is a claim about the organization and neither of them supports it.
 *
 * The pane itself is not built from this — it calls `catalogCards` again and
 * has its own loading and error states. This is only what the COUNTERS may say, and the two answers are
 * deliberately allowed to differ: the pane may show a spinner while the tab
 * beside it simply shows no number.
 */
function countableCatalogCards(
  page: ReturnType<typeof useIngestionSourcesPage>,
): ToolCard[] | null {
  // Sample mode answers from its own list, so no read gates it.
  if (page.sample.active) {
    return catalogCards({ tools: undefined, sampleActive: true });
  }
  if (!page.canManageTools || !page.catalog.loaded) return null;
  return catalogCards({
    tools: page.catalog.entries,
    sampleActive: false,
  });
}

/**
 * One line for all three panes, above the tabs, so a reader learns the size of
 * the estate without opening each one.
 *
 * Counted here rather than inside the strip: the shared component runs no
 * query and totals nothing, which is what keeps an unmeasured figure from
 * quietly becoming a zero on its way through a layout.
 */
function InventorySummaryStrip({
  page,
  cards,
  environments,
  sources,
}: {
  page: ReturnType<typeof useIngestionSourcesPage>;
  /** Null when the reader cannot see the registry, which draws the dash. */
  cards: readonly ToolCard[] | null;
  environments: readonly EnvironmentRow[];
  sources: readonly Source[] | undefined;
}) {
  // Environments are derived from the source list, so an unanswered source
  // read leaves them unmeasured rather than empty. Without this the strip said
  // "0 environments" beside a dashed source count, off the same silence.
  const environmentsMeasured = sources !== undefined;
  return (
    <GovernanceSummaryBar
      testId="inventory-summary"
      items={inventorySummaryItems({
        cards,
        environmentCount: environmentsMeasured ? environments.length : null,
        // Sample environments are wholly invented, so none of them was typed
        // in by this reader and all of them count as discovered.
        discoveredEnvironmentCount: environmentsMeasured
          ? environments.length - (page.sample.active ? 0 : page.addedEnvironments.length)
          : null,
        sourceCount: sources?.length ?? null,
        activeSourceCount: sources?.filter((source) => source.status === "active").length ?? null,
      })}
    />
  );
}

function InventoryPage() {
  const page = useIngestionSourcesPage();
  const { orgId, destinationCtx, sourcesQuery, mutations } = page;
  const { inventoryTab, selectInventoryTab } = useInventoryTab();

  const cards = countableCatalogCards(page);
  const environments = environmentRows({
    sources: sourcesQuery.data,
    sampleActive: page.sample.active,
    added: page.addedEnvironments,
  });
  const sources = page.sample.active ? SAMPLE_INGESTION_SOURCES : sourcesQuery.data;

  return (
    <GovernanceLayout pageTitle="Inventory · AI Governance · LangWatch">
      <PageLayout.Header>
        <InventoryHeader />
        <Spacer />
        <InventoryHeaderActions page={page} inventoryTab={inventoryTab} />
      </PageLayout.Header>

      <PageLayout.Container>
        <VStack align="stretch" gap={6} width="full">
          {page.sample.active && (
            <SampleDataBanner>
              These tools, figures and environments are an illustration of what the inventory holds
              once your tools report. Nothing here is real.
            </SampleDataBanner>
          )}

          <SourceComposerDrawer
            isOpen={page.composing}
            organizationId={orgId}
            destinationCtx={destinationCtx}
            composer={page.composer}
            setComposer={page.setComposer}
            invalidFieldKeys={page.invalidFieldKeys}
            isPending={mutations.create.isPending}
            refusal={mutations.create.error}
            onSubmit={page.onSubmit}
            onClose={page.closeComposer}
          />

          <InventorySummaryStrip
            page={page}
            cards={cards}
            environments={environments}
            sources={sources}
          />

          <InventoryTabs
            inventoryTab={inventoryTab}
            selectInventoryTab={selectInventoryTab}
            catalogCount={cards?.length}
            // Derived from the source list, so it goes uncounted on the same
            // silence that leaves the Sources tab uncounted beside it.
            environmentCount={sources === undefined ? undefined : environments.length}
            sourceCount={sources?.length}
            catalog={
              <InventoryCatalogPane
                catalog={page.catalog}
                canManage={page.canManageTools}
                sampleActive={page.sample.active}
                layout={page.catalogLayout}
                onEdit={(entry) => page.setToolDrawer({ mode: "edit", entry })}
              />
            }
            environments={
              <EnvironmentsTab
                canRead={page.canRead}
                sources={sourcesQuery.data}
                sampleActive={page.sample.active}
                added={page.addedEnvironments}
                // The header's own control, rendered a second time. Same
                // component, so one label and one flow — the empty state never
                // invents a second doorway with different words.
                createAction={
                  <AddEnvironmentControl onAdd={() => page.setAddingEnvironment(true)} />
                }
              />
            }
            sources={
              <>
                <InventorySourcesPane page={page} />
                <InventorySecurityLakePane page={page} />
              </>
            }
          />
        </VStack>
      </PageLayout.Container>

      <InventoryOverlays page={page} />
    </GovernanceLayout>
  );
}

/**
 * The page's dialogs and drawers, which sit outside the content column.
 *
 * Grouped so the page body reads as the layout it is. Each of them is opened
 * from somewhere different — a header button, a row menu, a mutation's reply —
 * and every one of them is closed by writing the page state back to null,
 * which is the only thing they have in common and the reason they are all
 * mounted at this level rather than beside whatever opened them.
 */
function InventoryOverlays({ page }: { page: ReturnType<typeof useIngestionSourcesPage> }) {
  const { orgId } = page;
  return (
    <>
      <AddEnvironmentDialog
        isOpen={page.addingEnvironment}
        onClose={() => page.setAddingEnvironment(false)}
        onAdd={page.addEnvironment}
      />

      <SecretModal details={page.secretModal} onClose={() => page.setSecretModal(null)} />

      <AiToolEntryDrawer
        organizationId={orgId}
        state={page.toolDrawer}
        onClose={() => page.setToolDrawer(null)}
      />

      <RemoveToolDialog
        pending={page.catalog.pendingDelete}
        isRemoving={page.catalog.isRemoving}
        onCancel={() => page.catalog.setPendingDelete(null)}
        onConfirm={page.catalog.confirmDelete}
      />
    </>
  );
}

/**
 * Connect a source, in one place, and only for a viewer holding
 * `ingestionSources:manage`.
 *
 * There used to be two of these: one in the page header and a second, outline
 * one down inside the Sources table's own header. Both opened the same menu
 * and created the same thing, so a reader had to work out which of two
 * differently-worded, differently-weighted buttons was the real one. Create
 * now lives in the page header, and the empty state renders this same
 * component rather than a button of its own.
 *
 * IT NO LONGER DOUBLES AS "ADD TOOL". While the Catalog pane was built from
 * the source list, one button under two labels was honest — the two panes were
 * two views of one object. They are not any more: the catalog lists what the
 * organization registered and this connects the pipe telemetry arrives on, so
 * the Catalog pane has its own control ({@link AddToolControl}).
 *
 * The plan cap lives here rather than at either call site. It used to be
 * carried by the in-content control alone, so the header's own button would
 * happily open a menu for an organization that had already hit its limit.
 */
function AddSourceControl({
  isEnterprise,
  sourceCount,
  onAdd,
}: {
  isEnterprise: boolean;
  sourceCount: number;
  onAdd: (sourceType: SourceType) => void;
}) {
  const atCap = !isEnterprise && sourceCount >= NON_ENTERPRISE_INGESTION_SOURCE_CAP;
  return (
    <AddIngestionSourceMenu
      isEnterprise={isEnterprise}
      disabledReason={
        atCap ? "Source limit reached. Upgrade to Enterprise for unlimited sources." : undefined
      }
      hint={
        !isEnterprise
          ? `Your plan includes up to ${NON_ENTERPRISE_INGESTION_SOURCE_CAP} sources. Upgrade to Enterprise for unlimited.`
          : "A source is where this organization's AI usage is read from."
      }
      onPick={onAdd}
    >
      <PageLayout.HeaderButton disabled={atCap}>
        <Plus size={14} /> Add source
      </PageLayout.HeaderButton>
    </AddIngestionSourceMenu>
  );
}

export default withGovernanceSection(InventoryPage);
