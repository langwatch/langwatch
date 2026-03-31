from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union, cast

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
        start_date (Union[float, str]):
        end_date (Union[float, str]):
        query (Union[Unset, str]):
        filters (Union[Unset, PostApiTracesSearchBodyFilters]):
        trace_ids (Union[Unset, list[str]]):
        negate_filters (Union[Unset, bool]):
        page_offset (Union[Unset, float]):
        page_size (Union[Unset, float]):
        group_by (Union[Unset, str]):
        sort_by (Union[Unset, str]):
        sort_direction (Union[Unset, str]):
        updated_at (Union[Unset, float]):
        scroll_id (Union[None, Unset, str]):
        format_ (Union[Unset, PostApiTracesSearchBodyFormat]): Output format: 'digest' (AI-readable trace digest) or
            'json' (full raw data)
        include_spans (Union[Unset, bool]): When true, fetches full span data for each trace. Useful for bulk export.
            Default false.
        llm_mode (Union[Unset, bool]):
    """

    start_date: Union[float, str]
    end_date: Union[float, str]
    query: Union[Unset, str] = UNSET
    filters: Union[Unset, "PostApiTracesSearchBodyFilters"] = UNSET
    trace_ids: Union[Unset, list[str]] = UNSET
    negate_filters: Union[Unset, bool] = UNSET
    page_offset: Union[Unset, float] = UNSET
    page_size: Union[Unset, float] = UNSET
    group_by: Union[Unset, str] = UNSET
    sort_by: Union[Unset, str] = UNSET
    sort_direction: Union[Unset, str] = UNSET
    updated_at: Union[Unset, float] = UNSET
    scroll_id: Union[None, Unset, str] = UNSET
    format_: Union[Unset, PostApiTracesSearchBodyFormat] = UNSET
    include_spans: Union[Unset, bool] = UNSET
    llm_mode: Union[Unset, bool] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        start_date: Union[float, str]
        start_date = self.start_date

        end_date: Union[float, str]
        end_date = self.end_date

        query = self.query

        filters: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.filters, Unset):
            filters = self.filters.to_dict()

        trace_ids: Union[Unset, list[str]] = UNSET
        if not isinstance(self.trace_ids, Unset):
            trace_ids = self.trace_ids

        negate_filters = self.negate_filters

        page_offset = self.page_offset

        page_size = self.page_size

        group_by = self.group_by

        sort_by = self.sort_by

        sort_direction = self.sort_direction

        updated_at = self.updated_at

        scroll_id: Union[None, Unset, str]
        if isinstance(self.scroll_id, Unset):
            scroll_id = UNSET
        else:
            scroll_id = self.scroll_id

        format_: Union[Unset, str] = UNSET
        if not isinstance(self.format_, Unset):
            format_ = self.format_.value

        include_spans = self.include_spans

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
        if include_spans is not UNSET:
            field_dict["includeSpans"] = include_spans
        if llm_mode is not UNSET:
            field_dict["llmMode"] = llm_mode

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_traces_search_body_filters import PostApiTracesSearchBodyFilters

        d = dict(src_dict)

        def _parse_start_date(data: object) -> Union[float, str]:
            return cast(Union[float, str], data)

        start_date = _parse_start_date(d.pop("startDate"))

        def _parse_end_date(data: object) -> Union[float, str]:
            return cast(Union[float, str], data)

        end_date = _parse_end_date(d.pop("endDate"))

        query = d.pop("query", UNSET)

        _filters = d.pop("filters", UNSET)
        filters: Union[Unset, PostApiTracesSearchBodyFilters]
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

        def _parse_scroll_id(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        scroll_id = _parse_scroll_id(d.pop("scrollId", UNSET))

        _format_ = d.pop("format", UNSET)
        format_: Union[Unset, PostApiTracesSearchBodyFormat]
        if isinstance(_format_, Unset):
            format_ = UNSET
        else:
            format_ = PostApiTracesSearchBodyFormat(_format_)

        include_spans = d.pop("includeSpans", UNSET)

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
            include_spans=include_spans,
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
