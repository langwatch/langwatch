import { useMemo } from "react";
import { describeError } from "../../../../model/describe-error";
import { HandledErrorAlert } from "../../../../ui/elements/ops-handled-error-alert";
import { useDejaViewState } from "../../behavior/deja-view-state";
import { type EventResult } from "../../model/deja-view-types";
import { DejaView } from "./deja-view-content";
import { Kbd } from "../../../../ui/elements/ops-kbd";
import { api } from "../../../../behavior/ops-api";
import { useOpsRouter as useRouter } from "../../../../behavior/ops-router";

export function DejaViewContent() {
  const router = useRouter();
  const state = useDejaViewState(router.asPath);
  const selectedAggregate = state.selectedAggregate;

  const searchResults = api.ops.searchAggregates.useQuery(
    {
      query: state.submittedQuery,
      tenantId: state.submittedTenant || void 0,
    },
    {
      enabled: state.hasSearched,
    },
  );

  // DejaView search is bounded server-side to the last 365 days (the ops
  // router supplies the sinceMs). Cold-tier storage kicks in earlier
  // (env-var-derived from CLICKHOUSE_COLD_STORAGE_EVENT_LOG_TTL_DAYS) -
  // aggregates inside the search window but past the hot tier still come
  // back, they're just quite some slower. The banner under the search
  // surfaces both numbers so the operator sees the bounds up front
  // instead of guessing why an old aggregate didn't show up.
  const searchWindowQuery = api.ops.getEventLogSearchWindow.useQuery(void 0, {
    staleTime: 60 * 60 * 1000,
  });
  const searchLookbackDays = searchWindowQuery.data?.searchLookbackDays ?? null;
  const hotTierDays = searchWindowQuery.data?.hotTierDays ?? null;

  const eventsQuery = api.ops.loadAggregateEvents.useQuery(
    {
      aggregateId: state.selectedAggregate?.aggregateId ?? "",
      tenantId: state.selectedAggregate?.tenantId ?? "",
    },
    {
      enabled: !!state.selectedAggregate,
    },
  );

  const projectionsQuery = api.ops.listProjections.useQuery(void 0, {
    enabled: !!state.selectedAggregate,
  });

  const projectionStateQuery = api.ops.computeProjectionState.useQuery(
    {
      aggregateId: state.selectedAggregate?.aggregateId ?? "",
      tenantId: state.selectedAggregate?.tenantId ?? "",
      projectionName: state.selectedProjection ?? "",
      eventIndex: state.eventCursor,
    },
    {
      enabled: !!state.selectedProjection && !!state.selectedAggregate,
    },
  );

  const previousProjectionStateQuery = api.ops.computeProjectionState.useQuery(
    {
      aggregateId: state.selectedAggregate?.aggregateId ?? "",
      tenantId: state.selectedAggregate?.tenantId ?? "",
      projectionName: state.selectedProjection ?? "",
      eventIndex: Math.max(0, state.eventCursor - 1),
    },
    {
      enabled:
        !!state.selectedProjection &&
        !!state.selectedAggregate &&
        state.showDiff &&
        state.eventCursor > 0,
    },
  );

  const events: EventResult[] = eventsQuery.data ?? [];

  const currentAggregateType = useMemo(() => {
    if (!searchResults.data || !selectedAggregate) return null;
    const agg = searchResults.data.find(
      (a) =>
        a.aggregateId === selectedAggregate.aggregateId &&
        a.tenantId === selectedAggregate.tenantId,
    );
    return agg?.aggregateType ?? null;
  }, [searchResults.data, selectedAggregate]);

  const matchingProjections = useMemo(() => {
    if (!projectionsQuery.data || !currentAggregateType) return [];
    return projectionsQuery.data.projections.filter(
      (p) => p.aggregateType === currentAggregateType,
    );
  }, [projectionsQuery.data, currentAggregateType]);

  const matchingEventSubscribers = useMemo(() => {
    if (!projectionsQuery.data || !currentAggregateType) return [];
    return projectionsQuery.data.eventSubscribers.filter(
      (s) => s.aggregateType === currentAggregateType,
    );
  }, [projectionsQuery.data, currentAggregateType]);

  const managerQuery = api.ops.getAggregateProcessManagers.useQuery(
    {
      aggregateType: currentAggregateType ?? "",
      tenantId: state.selectedAggregate?.tenantId ?? "",
      aggregateId: state.selectedAggregate?.aggregateId ?? "",
    },
    {
      enabled: !!currentAggregateType && !!state.selectedAggregate,
      refetchInterval: 15_000,
    },
  );

  return (
    <DejaView
      searchQuery={state.searchQuery}
      tenantFilter={state.tenantFilter}
      hasSearched={state.hasSearched}
      searchResults={searchResults.data}
      searchLoading={searchResults.isFetching}
      searchError={
        searchResults.error ? (
          <HandledErrorAlert error={searchResults.error} fallbackTitle="Couldn't run this search" />
        ) : (
          void 0
        )
      }
      searchLookbackDays={searchLookbackDays}
      hotTierDays={hotTierDays}
      hotTierEnvVar={searchWindowQuery.data?.hotTierEnvVar ?? null}
      selectedAggregate={state.selectedAggregate}
      events={events}
      eventsLoading={eventsQuery.isLoading}
      eventsError={
        eventsQuery.error ? (
          <HandledErrorAlert error={eventsQuery.error} fallbackTitle="Couldn't load these events" />
        ) : (
          void 0
        )
      }
      eventCursor={state.eventCursor}
      selectedProjection={state.selectedProjection}
      showEventDetail={state.showEventDetail}
      showDiff={state.showDiff}
      matchingProjections={matchingProjections}
      matchingEventSubscribers={matchingEventSubscribers}
      projectionState={projectionStateQuery.data?.state}
      previousProjectionState={previousProjectionStateQuery.data?.state}
      projectionStateLoading={projectionStateQuery.isLoading}
      managers={managerQuery.data ?? []}
      managersLoading={managerQuery.isLoading}
      managersError={
        managerQuery.error
          ? describeError({
              error: managerQuery.error,
              fallbackTitle: "Could not load process managers",
            })
          : null
      }
      renderKey={(label) => <Kbd>{label}</Kbd>}
      onSearchQueryChange={state.setSearchQuery}
      onTenantFilterChange={state.setTenantFilter}
      onSearch={state.onSearch}
      onSelectAggregate={state.onSelectAggregate}
      onBack={state.onBack}
      onSelectProjection={state.setSelectedProjection}
      onToggleDiff={() => state.setShowDiff((value) => !value)}
      onToggleEventDetail={state.toggleEventDetail}
      onSelectEvent={state.setEventCursor}
    />
  );
}
