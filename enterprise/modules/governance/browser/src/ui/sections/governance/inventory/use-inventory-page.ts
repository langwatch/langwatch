// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AiToolEntry } from "@langwatch/enterprise-governance-contract";
import { nowInstant } from "@langwatch/time";
import { useEffect, useState } from "react";

import { api } from "../../../../behavior/governance-api.ts";
import { useGovernanceSearchParams } from "../../../../behavior/governance-router.ts";
import { useGovernancePlan, useGovernanceScope } from "../../../../behavior/governance-session.ts";
import { useAiToolCatalog } from "../../../../features/ai-tools/ui/sections/use-ai-tool-catalog.ts";
import type { EnvironmentRow } from "../../../../features/ingestion-sources/environments/discovered-environments.ts";
import {
  gatedSourceTypeOptions,
  type SourceType,
} from "../../../../features/ingestion-sources/model/ingestion-source-catalog.ts";
import type { ToolCatalogLayout } from "../../../../features/ingestion-sources/toolCatalog/tool-catalog-cards.tsx";
import { useSampleMode } from "../../../../ui/elements/governance-sample-mode.ts";
import { useDestinationContext } from "../ingestion-source-forms.ts";
import { useSourceComposer } from "./use-source-composer.ts";

/**
 * Admin CRUD for IngestionSources, the per-platform fleet config that powers the
 * Activity Monitor pillar, wired to api.ingestionSources.*.
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 */

/**
 * What the Catalog and Environments panes need, and nothing the source
 * composer does.
 *
 * Its own hook because it is a different concern from the source CRUD (`useSourceComposer`):
 * this is how the page is being READ — which layout, which samples, which
 * environments the reader typed in — while the other is what is being written.
 * Keeping them apart also keeps either one small enough to follow.
 */
function useInventoryPanes({ orgId, canManageTools }: { orgId: string; canManageTools: boolean }) {
  const catalog = useAiToolCatalog({
    organizationId: orgId,
    enabled: canManageTools,
  });

  /* Page state, not a routed drawer: `AiToolEntryDrawer` takes its target as an in-memory entry. */
  const [toolDrawer, setToolDrawer] = useState<
    { mode: "create"; type: AiToolEntry["type"] } | { mode: "edit"; entry: AiToolEntry } | null
  >(null);

  const startToolRegistration = () => {
    setToolDrawer({ mode: "create", type: "coding_assistant" });
  };

  const sample = useSampleMode();

  const [catalogLayout, setCatalogLayout] = useState<ToolCatalogLayout>("grid");

  const [addingEnvironment, setAddingEnvironment] = useState(false);
  /**
   * Environments the reader added by hand this sitting. Component state on
   * purpose: nothing persists an environment yet, and the add dialog says so
   * rather than letting a row look saved.
   */
  const [addedEnvironments, setAddedEnvironments] = useState<EnvironmentRow[]>([]);

  /** Add a hand-entered environment for this sitting only. */
  const addEnvironment = ({ name, description }: { name: string; description: string }) => {
    setAddedEnvironments((previous) => [
      ...previous,
      {
        id: `added:${name}:${previous.length}`,
        name,
        description,
        createdIso: nowInstant().toString(),
        createdBy: "You, this session",
      },
    ]);
  };

  return {
    catalog,
    toolDrawer,
    setToolDrawer,
    startToolRegistration,
    sample,
    catalogLayout,
    setCatalogLayout,
    addingEnvironment,
    setAddingEnvironment,
    addedEnvironments,
    addEnvironment,
  };
}

/**
 * Everything the page needs: the org it is scoped to, the source list, the
 * composer/edit/secret state and the mutations that drive them, plus the pane
 * state from {@link useInventoryPanes}. State and callbacks only — the
 * component owns the markup.
 */
export function useIngestionSourcesPage() {
  const { organization, hasAnyPermission } = useGovernanceScope();
  // The host resolves the organization and its permissions from context
  // rather than an in-flight query, so there is no loading window to
  // distinguish from a genuine refusal the way the platform's
  // `useOrganizationTeamProject` had one.
  const isOrganizationLoading = false;
  const orgId = organization?.id ?? "";
  const { isEnterprise, isLoading: isPlanLoading } = useGovernancePlan();
  const canRead = hasAnyPermission("ingestionSources:view");
  const canManage = hasAnyPermission("ingestionSources:manage");
  // The Catalog pane's own grant: the registry and the ingest fleet are two
  // different things to be trusted with.
  const canManageTools = hasAnyPermission("aiTools:manage");
  const destinationCtx = useDestinationContext(organization);

  const sourcesQuery = api.ingestionSources.list.useQuery(
    { organizationId: orgId },
    {
      enabled: !!orgId && canRead,
      // needs a read hint: ingestion source pulled (health changes only on a pull)
    },
  );

  const panes = useInventoryPanes({ orgId, canManageTools });

  const utils = api.useUtils();
  const refetch = () => utils.ingestionSources.list.invalidate({ organizationId: orgId });

  const composer = useSourceComposer({ orgId, refetch });

  useAddParam({
    isEnterprise,
    isPlanLoading,
    isPermissionLoading: isOrganizationLoading,
    canManage,
    canManageTools,
    startComposer: composer.startComposer,
    startToolRegistration: panes.startToolRegistration,
  });

  return {
    ...panes,
    ...composer,
    orgId,
    destinationCtx,
    isEnterprise,
    canRead,
    canManage,
    canManageTools,
    sourcesQuery,
  };
}

/**
 * The `?add=` deep link, in one owner.
 *
 * Two flows arrive through the same parameter and one hook has to dispatch
 * between them, because two hooks reading it would race: whichever ran first
 * would strip the parameter and the other would never see it.
 *
 *   `?add=1`            registers a tool. The address the Overview page's
 *                       "Add tool" chip points at, paired with `?tab=catalog`
 *                       so the reader lands on the pane the new tool joins.
 *   `?add=<sourceType>` opens the source composer on that type — the link the
 *                       docs and the rest of the section hand out.
 *
 * The parameter is consumed once and then left off the address, so a refresh
 * or a back-button does not reopen the drawer the reader just dismissed.
 *
 * A source type the Add source menu would not offer (unknown, retired, or
 * locked on this plan) is dropped silently, and so is either flow arriving for
 * a reader without the grant it needs. The plan gate is the same
 * `gatedSourceTypeOptions` the menu reads, so a locked type can no more slip
 * in through the address than through a click. Nothing is decided until the
 * plan and the grants are known: an Enterprise link must not be thrown away
 * because the plan query was a tick behind the page, and a manager's link must
 * not be thrown away because the organization query was.
 */
const ADD_TOOL_PARAM = "1";

/** The address without its `add=` flag, so a refresh does not reopen it. */
const withoutAddParam = (previous: URLSearchParams) => {
  const next = new URLSearchParams(previous);
  next.delete("add");
  return next;
};

/**
 * The source type the address asked for, or null when it named none the Add
 * source menu would offer on this plan.
 *
 * Its own function so the effect below stays a dispatch: the gate is the same
 * `gatedSourceTypeOptions` the menu reads, which is the point — a locked type
 * can no more slip in through the address than through a click.
 */
function requestedSourceType({
  requested,
  isEnterprise,
}: {
  requested: string;
  isEnterprise: boolean;
}): SourceType | null {
  const option = gatedSourceTypeOptions({ isEnterprise }).find(
    (candidate) => candidate.value === requested,
  );
  return option && !option.locked ? option.value : null;
}

/**
 * Open whichever flow the address asked for, if the reader may open it.
 *
 * Either grant missing means nothing opens and the flag is still dropped: a
 * link is not an authorisation, and leaving the flag on the address would
 * reopen the refusal on every refresh.
 */
function openAddFlow({
  requested,
  isEnterprise,
  canManage,
  canManageTools,
  startComposer,
  startToolRegistration,
}: {
  requested: string;
  isEnterprise: boolean;
  canManage: boolean;
  canManageTools: boolean;
  startComposer: (sourceType: SourceType) => void;
  startToolRegistration: () => void;
}) {
  if (requested === ADD_TOOL_PARAM) {
    if (canManageTools) startToolRegistration();
    return;
  }
  if (!canManage) return;
  const sourceType = requestedSourceType({ requested, isEnterprise });
  if (sourceType) startComposer(sourceType);
}

function useAddParam({
  isEnterprise,
  isPlanLoading,
  isPermissionLoading,
  canManage,
  canManageTools,
  startComposer,
  startToolRegistration,
}: {
  isEnterprise: boolean;
  isPlanLoading: boolean;
  isPermissionLoading: boolean;
  canManage: boolean;
  canManageTools: boolean;
  startComposer: (sourceType: SourceType) => void;
  startToolRegistration: () => void;
}) {
  const [searchParams, setSearchParams] = useGovernanceSearchParams();
  const requested = searchParams.get("add");
  useEffect(() => {
    // The plan gate's own reason, applied to grants: an unread grant is not a
    // refused one. `isPermissionLoading` is always false here — this host
    // resolves the organization and its permissions synchronously from
    // context rather than an in-flight query — kept as a parameter so a
    // future async host still has somewhere to report it.
    if (requested === null || isPlanLoading || isPermissionLoading) return;
    openAddFlow({
      requested,
      isEnterprise,
      canManage,
      canManageTools,
      startComposer,
      startToolRegistration,
    });
    setSearchParams(withoutAddParam, { replace: true });
  }, [
    requested,
    isPlanLoading,
    isPermissionLoading,
    isEnterprise,
    canManage,
    canManageTools,
    startComposer,
    startToolRegistration,
    setSearchParams,
  ]);
}

/**
 * The inventory's tabs: Catalog (the tool-tiles editor), Environments (where
 * those tools run) and Sources (the ingestion-sources table). Every one of
 * them answers "what does this organization run", which is the question this
 * page exists for.
 *
 * ANOMALY RULES USED TO BE A FOURTH TAB AND IS NOT ONE ANY MORE. A rule is a
 * standing instruction about what to watch for, not a thing the organization
 * runs, so it belongs with alerts and signals rather than in an inventory.
 * `AnomalyRulesTab` is kept, though no route renders it yet.
 *
 * The Catalog pane is `ToolCatalogTab`, over the page's own registry read;
 * registering or editing a tool opens `AiToolEntryDrawer` from the page.
 */
const INVENTORY_TABS = ["catalog", "environments", "sources"] as const;

export type InventoryTab = (typeof INVENTORY_TABS)[number];

const isInventoryTab = (value: string | null): value is InventoryTab =>
  INVENTORY_TABS.some((tab) => tab === value);

/** The pane a bare address opens on, the same for every reader. */
const DEFAULT_INVENTORY_TAB: InventoryTab = "catalog";

/** A non-default tab lives in the address (?tab=); an unknown value degrades to the default. */
export function useInventoryTab() {
  const [searchParams, setSearchParams] = useGovernanceSearchParams();
  const requestedTab = searchParams.get("tab");
  const inventoryTab = isInventoryTab(requestedTab) ? requestedTab : DEFAULT_INVENTORY_TAB;
  const selectInventoryTab = (tab: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (tab === DEFAULT_INVENTORY_TAB) next.delete("tab");
        else next.set("tab", tab);
        return next;
      },
      { replace: true },
    );
  return { inventoryTab, selectInventoryTab };
}
