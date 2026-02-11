from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_traces_search_body_format import PostApiTracesSearchBodyFormat
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_traces_search_body_filters import PostApiTracesSearchBodyFilters


T = TypeVar("T", bound="PostApiTracesSearchBody")


@_attrs_define
class PostApiTracesSearchBody:
    """
    Attributes:
        start_date (float | str):
        end_date (float | str):
        query (str | Unset):
        filters (PostApiTracesSearchBodyFilters | Unset):
        trace_ids (list[str] | Unset):
        negate_filters (bool | Unset):
        page_offset (float | Unset):
        page_size (float | Unset):
        group_by (str | Unset):
        sort_by (str | Unset):
        sort_direction (str | Unset):
        updated_at (float | Unset):
        scroll_id (None | str | Unset):
        format_ (PostApiTracesSearchBodyFormat | Unset): Output format: 'digest' (AI-readable trace digest) or 'json'
            (full raw data)
        llm_mode (bool | Unset):
    """

    start_date: float | str
    end_date: float | str
    query: str | Unset = UNSET
    filters: PostApiTracesSearchBodyFilters | Unset = UNSET
    trace_ids: list[str] | Unset = UNSET
    negate_filters: bool | Unset = UNSET
    page_offset: float | Unset = UNSET
    page_size: float | Unset = UNSET
    group_by: str | Unset = UNSET
    sort_by: str | Unset = UNSET
    sort_direction: str | Unset = UNSET
    updated_at: float | Unset = UNSET
    scroll_id: None | str | Unset = UNSET
    format_: PostApiTracesSearchBodyFormat | Unset = UNSET
    llm_mode: bool | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        start_date: float | str
        start_date = self.start_date

        end_date: float | str
        end_date = self.end_date

        query = self.query

        filters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.filters, Unset):
            filters = self.filters.to_dict()

        trace_ids: list[str] | Unset = UNSET
        if not isinstance(self.trace_ids, Unset):
            trace_ids = self.trace_ids

        negate_filters = self.negate_filters

        page_offset = self.page_offset

        page_size = self.page_size

        group_by = self.group_by

        sort_by = self.sort_by

        sort_direction = self.sort_direction

        updated_at = self.updated_at

        scroll_id: None | str | Unset
        if isinstance(self.scroll_id, Unset):
            scroll_id = UNSET
        else:
            scroll_id = self.scroll_id

        format_: str | Unset = UNSET
        if not isinstance(self.format_, Unset):
            format_ = self.format_.value

        llm_mode = self.llm_mode

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "startDate": start_date,
                "endDate": end_date,
            }
        )
        if query is not UNSET:
            field_dict["query"] = query
        if filters is not UNSET:
            field_dict["filters"] = filters
        if trace_ids is not UNSET:
            field_dict["traceIds"] = trace_ids
        if negate_filters is not UNSET:
            field_dict["negateFilters"] = negate_filters
        if page_offset is not UNSET:
            field_dict["pageOffset"] = page_offset
        if page_size is not UNSET:
            field_dict["pageSize"] = page_size
        if group_by is not UNSET:
            field_dict["groupBy"] = group_by
        if sort_by is not UNSET:
            field_dict["sortBy"] = sort_by
        if sort_direction is not UNSET:
            field_dict["sortDirection"] = sort_direction
        if updated_at is not UNSET:
            field_dict["updatedAt"] = updated_at
        if scroll_id is not UNSET:
            field_dict["scrollId"] = scroll_id
        if format_ is not UNSET:
            field_dict["format"] = format_
        if llm_mode is not UNSET:
            field_dict["llmMode"] = llm_mode

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_traces_search_body_filters import PostApiTracesSearchBodyFilters

        d = dict(src_dict)

        def _parse_start_date(data: object) -> float | str:
            return cast(float | str, data)

        start_date = _parse_start_date(d.pop("startDate"))

        def _parse_end_date(data: object) -> float | str:
            return cast(float | str, data)

        end_date = _parse_end_date(d.pop("endDate"))

        query = d.pop("query", UNSET)

        _filters = d.pop("filters", UNSET)
        filters: PostApiTracesSearchBodyFilters | Unset
        if isinstance(_filters, Unset):
            filters = UNSET
        else:
            filters = PostApiTracesSearchBodyFilters.from_dict(_filters)

        trace_ids = cast(list[str], d.pop("traceIds", UNSET))

        negate_filters = d.pop("negateFilters", UNSET)

        page_offset = d.pop("pageOffset", UNSET)

        page_size = d.pop("pageSize", UNSET)

        group_by = d.pop("groupBy", UNSET)

        sort_by = d.pop("sortBy", UNSET)

        sort_direction = d.pop("sortDirection", UNSET)

        updated_at = d.pop("updatedAt", UNSET)

        def _parse_scroll_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        scroll_id = _parse_scroll_id(d.pop("scrollId", UNSET))

        _format_ = d.pop("format", UNSET)
        format_: PostApiTracesSearchBodyFormat | Unset
        if isinstance(_format_, Unset):
            format_ = UNSET
        else:
            format_ = PostApiTracesSearchBodyFormat(_format_)

        llm_mode = d.pop("llmMode", UNSET)

        post_api_traces_search_body = cls(
            start_date=start_date,
            end_date=end_date,
            query=query,
            filters=filters,
            trace_ids=trace_ids,
            negate_filters=negate_filters,
            page_offset=page_offset,
            page_size=page_size,
            group_by=group_by,
            sort_by=sort_by,
            sort_direction=sort_direction,
            updated_at=updated_at,
            scroll_id=scroll_id,
            format_=format_,
            llm_mode=llm_mode,
        )

        post_api_traces_search_body.additional_properties = d
        return post_api_traces_search_body

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
