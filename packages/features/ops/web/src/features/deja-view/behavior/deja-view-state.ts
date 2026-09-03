import { useCallback, useEffect, useMemo, useState } from "react";
import { buildFragment, parseFragment } from "../model/deja-view-fragment";

type AggregateSelection = { aggregateId: string; tenantId: string } | null;

/** Browser state and URL-fragment synchronisation for the DejaView workspace. */
export function useDejaViewState(url: string) {
  const initialState = useMemo(() => parseFragment(url), [url]);
  const initialAggregate =
    initialState.aggId && initialState.aggTenant
      ? {
          aggregateId: initialState.aggId,
          tenantId: initialState.aggTenant,
        }
      : null;
  const deepLinkedAggregate = initialState.query ? null : initialAggregate;
  const initialQuery = initialState.query ?? deepLinkedAggregate?.aggregateId ?? "";
  const initialTenant = initialState.tenant ?? deepLinkedAggregate?.tenantId ?? "";

  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [tenantFilter, setTenantFilter] = useState(initialTenant);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [submittedTenant, setSubmittedTenant] = useState(initialTenant);
  const [hasSearched, setHasSearched] = useState(
    Boolean(initialState.query || deepLinkedAggregate),
  );
  const [selectedAggregate, setSelectedAggregate] =
    useState<AggregateSelection>(initialAggregate);
  const [eventCursor, setEventCursor] = useState(initialState.event ?? 0);
  const [selectedProjection, setSelectedProjection] = useState<string | null>(
    initialState.proj ?? null,
  );
  const [showEventDetail, setShowEventDetail] = useState(initialState.detail ?? false);
  const [showDiff, setShowDiff] = useState(true);

  useEffect(() => {
    const fragment = buildFragment({
      query: submittedQuery || void 0,
      tenant: submittedTenant || void 0,
      aggId: selectedAggregate?.aggregateId,
      aggTenant: selectedAggregate?.tenantId,
      event: selectedAggregate ? eventCursor : void 0,
      proj: selectedProjection ?? void 0,
      detail: showEventDetail || void 0,
    });
    const nextUrl = url.split("#")[0] + (fragment ? `#${fragment}` : "");
    window.history.replaceState(null, "", nextUrl);
  }, [
    submittedQuery,
    submittedTenant,
    selectedAggregate,
    eventCursor,
    selectedProjection,
    showEventDetail,
    url,
  ]);

  const onSearch = useCallback(() => {
    setSubmittedQuery(searchQuery);
    setSubmittedTenant(tenantFilter);
    setHasSearched(true);
    setSelectedAggregate(null);
    setEventCursor(0);
    setSelectedProjection(null);
    setShowEventDetail(false);
  }, [searchQuery, tenantFilter]);

  const onSelectAggregate = useCallback((aggregateId: string, tenantId: string) => {
    setSelectedAggregate({ aggregateId, tenantId });
    setEventCursor(0);
    setSelectedProjection(null);
    setShowEventDetail(false);
  }, []);

  const onBack = useCallback(() => {
    setSelectedAggregate(null);
    setEventCursor(0);
    setSelectedProjection(null);
    setShowEventDetail(false);
  }, []);
  const toggleEventDetail = useCallback(
    () => setShowEventDetail((current) => !current),
    [],
  );

  return {
    searchQuery,
    tenantFilter,
    submittedQuery,
    submittedTenant,
    hasSearched,
    selectedAggregate,
    eventCursor,
    selectedProjection,
    showEventDetail,
    showDiff,
    setSearchQuery,
    setTenantFilter,
    setSelectedProjection,
    setShowDiff,
    onSearch,
    onSelectAggregate,
    onBack,
    setEventCursor,
    toggleEventDetail,
  };
}
