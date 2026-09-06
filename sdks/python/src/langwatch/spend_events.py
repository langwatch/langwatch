"""
API facade for the gateway billing reads: per-request spend events,
reconciliation summaries, replay, and end-user spend with the applicable
caps.

There is no eager whole-collection method on spend events or spend
summaries because both are unbounded ledger reads: walk them with
``iterate`` and ``iter_summaries``, or page them deliberately with
``list_page`` and ``summaries_page``.

Both reads take the SAME filters. A reconciliation checksums the rollups
and diffs the events when a checksum disagrees, so a divergence can be
walked on exactly the narrowing that produced it.

All routes are organization-anchored: authenticate with an organization
API key (``sk-lw-...``) via ``langwatch.setup``. Uses httpx via the
generated REST API client for HTTP transport.
"""

from typing import Any, Dict, Iterator, Mapping, Optional, Sequence, Union

import httpx

from langwatch.generated.langwatch_rest_api_client.client import (
    Client as LangWatchRestApiClient,
)
from langwatch.state import get_instance
from langwatch.utils.gateway_http import (
    quote_path_segment,
    raise_for_status,
    walk_cursor_pages,
)
from langwatch.utils.initialization import ensure_setup

FilterValue = Optional[Union[str, Sequence[str]]]
"""One value or many. Many means "any of these"; naming two different
filters narrows."""

MetadataFilter = Optional[Mapping[str, Union[str, Sequence[str]]]]
"""Your own request metadata, e.g. ``{"customer_tier": "gold"}``. Several
values for one key widen that key; several keys narrow."""

_FILTER_PARAMS = (
    "project_id",
    "team_id",
    "external_id",
    "virtual_key_id",
    "end_user_id",
    "principal_user_id",
    "model",
    "provider_key",
    "request_type",
    "label",
)
"""Filter names that go on the wire unchanged, in the order the API
documents them. Repeating a parameter is how the API widens it."""


def _spend_filter_params(filters: Mapping[str, Any]) -> Dict[str, Any]:
    """The query parameters for a set of spend filters.

    A value that is a list is left as one: httpx repeats the parameter once
    per element, which is what widens the filter server-side. A filter left
    unset sends nothing; one set to an empty list sends nothing either,
    since httpx has no parameter to repeat, and the server reads an absent
    filter as "do not narrow on this".
    """
    params: Dict[str, Any] = {}
    for name in _FILTER_PARAMS:
        value = filters.get(name)
        if value is not None:
            params[name] = list(value) if isinstance(value, (list, tuple)) else value
    metadata = filters.get("metadata")
    if metadata:
        pairs = []
        for key, value in metadata.items():
            # The API splits a pair on its FIRST colon, so a key carrying one
            # would silently address a different key and report spend for a
            # filter nobody wrote. The TypeScript SDK and the CLI both refuse
            # it; refusing here keeps the three clients on one contract.
            if ":" in key:
                raise ValueError(f"A metadata key cannot contain a colon: {key}")
            values = value if isinstance(value, (list, tuple)) else [value]
            # An empty value would send `tier:`, which the server refuses,
            # because a missing map key reads back as the type default and
            # would match every request that lacks the key entirely.
            if any(one == "" for one in values):
                raise ValueError(f"A metadata value cannot be empty: {key}")
            pairs.extend(f"{key}:{one}" for one in values)
        params["metadata"] = pairs
    status = filters.get("status")
    if status is not None:
        params["status"] = status
    return params


class SpendEventsFacade:
    """Facade for spend events and reconciliation."""

    def __init__(self, rest_api_client: LangWatchRestApiClient) -> None:
        self._client = rest_api_client

    @classmethod
    def from_global(cls) -> "SpendEventsFacade":
        """Build the facade on the process-wide LangWatch client, setting it
        up first if nothing has yet."""
        ensure_setup()
        instance = get_instance()
        if instance is None:
            raise RuntimeError("LangWatch client has not been initialized. Call setup() first.")
        return cls(instance.rest_api_client)

    def _http(self) -> httpx.Client:
        return self._client.get_httpx_client()

    # ── spend events (the ledger read) ────────────────────────────────

    def list_page(
        self,
        *,
        from_ms: int,
        to_ms: int,
        cursor: Optional[str] = None,
        limit: Optional[int] = None,
        project_id: FilterValue = None,
        team_id: FilterValue = None,
        external_id: FilterValue = None,
        virtual_key_id: FilterValue = None,
        end_user_id: FilterValue = None,
        principal_user_id: FilterValue = None,
        model: FilterValue = None,
        provider_key: FilterValue = None,
        request_type: FilterValue = None,
        label: FilterValue = None,
        metadata: MetadataFilter = None,
        status: Optional[str] = None,
    ) -> Dict[str, Any]:
        """One page of spend event envelopes over the 13-month ledger, as
        {data, next_cursor}: diff by gateway_request_id.

        ``team_id`` is resolved to the projects that team owns and
        ``external_id`` to the keys carrying it, so a team with no projects
        and an external id nobody minted both match nothing rather than
        everything."""
        params: Dict[str, Any] = {"from": from_ms, "to": to_ms}
        if cursor is not None:
            params["cursor"] = cursor
        if limit is not None:
            params["limit"] = limit
        params.update(
            _spend_filter_params(
                {
                    "project_id": project_id,
                    "team_id": team_id,
                    "external_id": external_id,
                    "virtual_key_id": virtual_key_id,
                    "end_user_id": end_user_id,
                    "principal_user_id": principal_user_id,
                    "model": model,
                    "provider_key": provider_key,
                    "request_type": request_type,
                    "label": label,
                    "metadata": metadata,
                    "status": status,
                }
            )
        )
        response = self._http().get("/api/gateway/v1/spend-events", params=params)
        raise_for_status(response, operation="list spend events")
        return response.json()

    def iterate(
        self,
        *,
        from_ms: int,
        to_ms: int,
        limit: Optional[int] = None,
        project_id: FilterValue = None,
        team_id: FilterValue = None,
        external_id: FilterValue = None,
        virtual_key_id: FilterValue = None,
        end_user_id: FilterValue = None,
        principal_user_id: FilterValue = None,
        model: FilterValue = None,
        provider_key: FilterValue = None,
        request_type: FilterValue = None,
        label: FilterValue = None,
        metadata: MetadataFilter = None,
        status: Optional[str] = None,
    ) -> Iterator[Dict[str, Any]]:
        """Every spend event in the window, one envelope at a time, fetching
        a page only when the previous one runs out.

        Lazy on purpose: the window is a ledger range, so collecting it into
        a list first is a memory bound nobody chose."""
        filters: Dict[str, Any] = {
            "project_id": project_id,
            "team_id": team_id,
            "external_id": external_id,
            "virtual_key_id": virtual_key_id,
            "end_user_id": end_user_id,
            "principal_user_id": principal_user_id,
            "model": model,
            "provider_key": provider_key,
            "request_type": request_type,
            "label": label,
            "metadata": metadata,
            "status": status,
        }
        for page in walk_cursor_pages(
            lambda cursor: self.list_page(
                from_ms=from_ms,
                to_ms=to_ms,
                cursor=cursor,
                limit=limit,
                **filters,
            )
        ):
            yield from page["data"]

    def summaries_page(
        self,
        *,
        group_by: Union[str, Sequence[str]],
        from_ms: int,
        to_ms: int,
        cursor: Optional[str] = None,
        limit: Optional[int] = None,
        bucket: Optional[str] = None,
        timezone: Optional[str] = None,
        allow_unstable: bool = False,
        project_id: FilterValue = None,
        team_id: FilterValue = None,
        external_id: FilterValue = None,
        virtual_key_id: FilterValue = None,
        end_user_id: FilterValue = None,
        principal_user_id: FilterValue = None,
        model: FilterValue = None,
        provider_key: FilterValue = None,
        request_type: FilterValue = None,
        label: FilterValue = None,
        metadata: MetadataFilter = None,
        status: Optional[str] = None,
    ) -> Dict[str, Any]:
        """One page of reconciliation checksums, as {data, next_cursor}.

        Rollups are paged by group key ascending. Follow next_cursor until
        it comes back null: a full page does not mean the window held
        nothing more, so a reconciler that reads one page under-counts
        every key past the limit.

        group_by: one or two of "virtual_key", "end_user", "project",
        "model", "provider", "principal", "request_type". Each row's ``key``
        is the first dimension's value and ``group`` names them all, so two
        rows may share a key.

        bucket: "none" (the default), "hour" or "day", falling on the
        boundaries of ``timezone`` (an IANA zone, UTC by default).

        Grouping by model or provider, or into time buckets, is REFUSED with
        ``gateway_spend_group_by_unstable`` over a window recent enough that
        outcomes can still arrive: until a request settles, the model and
        provider recorded against it are the ones that were asked for, and
        they are replaced by the ones that actually served it. A page walk
        over a group that can move counts some requests twice and misses
        others. Reconciling closed periods never meets this; pass
        ``allow_unstable`` for a live view where the shape is enough.

        status: one of "success", "error", "confirmed", "failed" or
        "settled". "admitted" is REFUSED here, unlike on the events read: a
        rollup sums the cost of requests past admission, and an admitted
        request is still in flight with none of its own yet. Call
        ``list_page`` for those."""
        params: Dict[str, Any] = {
            "group_by": group_by if isinstance(group_by, str) else ",".join(group_by),
            "from": from_ms,
            "to": to_ms,
        }
        if cursor is not None:
            params["cursor"] = cursor
        if limit is not None:
            params["limit"] = limit
        if bucket is not None:
            params["bucket"] = bucket
        if timezone is not None:
            params["timezone"] = timezone
        if allow_unstable:
            params["allow_unstable"] = "true"
        params.update(
            _spend_filter_params(
                {
                    "project_id": project_id,
                    "team_id": team_id,
                    "external_id": external_id,
                    "virtual_key_id": virtual_key_id,
                    "end_user_id": end_user_id,
                    "principal_user_id": principal_user_id,
                    "model": model,
                    "provider_key": provider_key,
                    "request_type": request_type,
                    "label": label,
                    "metadata": metadata,
                    "status": status,
                }
            )
        )
        response = self._http().get("/api/gateway/v1/spend-summaries", params=params)
        raise_for_status(response, operation="spend summaries")
        return response.json()

    def iter_summaries(
        self,
        *,
        group_by: Union[str, Sequence[str]],
        from_ms: int,
        to_ms: int,
        limit: Optional[int] = None,
        bucket: Optional[str] = None,
        timezone: Optional[str] = None,
        allow_unstable: bool = False,
        project_id: FilterValue = None,
        team_id: FilterValue = None,
        external_id: FilterValue = None,
        virtual_key_id: FilterValue = None,
        end_user_id: FilterValue = None,
        principal_user_id: FilterValue = None,
        model: FilterValue = None,
        provider_key: FilterValue = None,
        request_type: FilterValue = None,
        label: FilterValue = None,
        metadata: MetadataFilter = None,
        status: Optional[str] = None,
    ) -> Iterator[Dict[str, Any]]:
        """Every rollup row in the window, walking the cursor for you.

        The whole-window read a reconciler actually wants, so getting the
        totals right does not depend on remembering to page. Each row
        carries event_count, settled_count, the token classes, and integer
        nano-USD cost.

        status takes the same values ``summaries_page`` does, so
        "admitted" is refused here too."""
        rest: Dict[str, Any] = {
            "bucket": bucket,
            "timezone": timezone,
            "allow_unstable": allow_unstable,
            "project_id": project_id,
            "team_id": team_id,
            "external_id": external_id,
            "virtual_key_id": virtual_key_id,
            "end_user_id": end_user_id,
            "principal_user_id": principal_user_id,
            "model": model,
            "provider_key": provider_key,
            "request_type": request_type,
            "label": label,
            "metadata": metadata,
            "status": status,
        }
        for page in walk_cursor_pages(
            lambda cursor: self.summaries_page(
                group_by=group_by,
                from_ms=from_ms,
                to_ms=to_ms,
                cursor=cursor,
                limit=limit,
                **rest,
            )
        ):
            yield from page["data"]

    def replay(
        self,
        *,
        from_ms: int,
        to_ms: int,
        endpoint_id: str,
    ) -> Dict[str, Any]:
        """Re-deliver a window of spend events to one webhook endpoint.
        Downstream dedup windows are finite; prefer iterate() + diff for old
        ranges."""
        response = self._http().post(
            "/api/gateway/v1/spend-events/replay",
            json={"from": from_ms, "to": to_ms, "endpoint_id": endpoint_id},
        )
        raise_for_status(response, operation="replay spend events")
        return response.json()["data"]

    def end_user_spend(
        self,
        end_user_id: str,
        *,
        window: Optional[str] = None,
        from_ms: Optional[int] = None,
        to_ms: Optional[int] = None,
        virtual_key_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """One end user's usage rollup over the asked window PLUS the
        applicable attributed-user template caps with boundary-aware
        current-period spend: the pair a rebilling platform polls."""
        params: Dict[str, Any] = {}
        if window is not None:
            params["window"] = window
        if from_ms is not None:
            params["from"] = from_ms
        if to_ms is not None:
            params["to"] = to_ms
        if virtual_key_id is not None:
            params["virtual_key_id"] = virtual_key_id
        response = self._http().get(
            f"/api/gateway/v1/end-users/{quote_path_segment(end_user_id)}/spend",
            params=params,
        )
        raise_for_status(response, operation="end-user spend")
        return response.json()["data"]
