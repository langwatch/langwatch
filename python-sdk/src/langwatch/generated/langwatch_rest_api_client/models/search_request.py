import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.search_request_filters import SearchRequestFilters


T = TypeVar("T", bound="SearchRequest")


@_attrs_define
class SearchRequest:
    """
    Attributes:
        query (Union[Unset, str]):
        start_date (Union[Unset, datetime.datetime]):
        end_date (Union[Unset, datetime.datetime]):
        page_size (Union[Unset, int]):  Example: 1000.
        scroll_id (Union[Unset, str]):  Example: 123.
        filters (Union[Unset, SearchRequestFilters]):
    """

    query: Union[Unset, str] = UNSET
    start_date: Union[Unset, datetime.datetime] = UNSET
    end_date: Union[Unset, datetime.datetime] = UNSET
    page_size: Union[Unset, int] = UNSET
    scroll_id: Union[Unset, str] = UNSET
    filters: Union[Unset, "SearchRequestFilters"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        query = self.query

        start_date: Union[Unset, str] = UNSET
        if not isinstance(self.start_date, Unset):
            start_date = self.start_date.isoformat()

        end_date: Union[Unset, str] = UNSET
        if not isinstance(self.end_date, Unset):
            end_date = self.end_date.isoformat()

        page_size = self.page_size

        scroll_id = self.scroll_id

        filters: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.filters, Unset):
            filters = self.filters.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if query is not UNSET:
            field_dict["query"] = query
        if start_date is not UNSET:
            field_dict["startDate"] = start_date
        if end_date is not UNSET:
            field_dict["endDate"] = end_date
        if page_size is not UNSET:
            field_dict["pageSize"] = page_size
        if scroll_id is not UNSET:
            field_dict["scrollId"] = scroll_id
        if filters is not UNSET:
            field_dict["filters"] = filters

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.search_request_filters import SearchRequestFilters

        d = dict(src_dict)
        query = d.pop("query", UNSET)

        _start_date = d.pop("startDate", UNSET)
        start_date: Union[Unset, datetime.datetime]
        if isinstance(_start_date, Unset):
            start_date = UNSET
        else:
            start_date = isoparse(_start_date)

        _end_date = d.pop("endDate", UNSET)
        end_date: Union[Unset, datetime.datetime]
        if isinstance(_end_date, Unset):
            end_date = UNSET
        else:
            end_date = isoparse(_end_date)

        page_size = d.pop("pageSize", UNSET)

        scroll_id = d.pop("scrollId", UNSET)

        _filters = d.pop("filters", UNSET)
        filters: Union[Unset, SearchRequestFilters]
        if isinstance(_filters, Unset):
            filters = UNSET
        else:
            filters = SearchRequestFilters.from_dict(_filters)

        search_request = cls(
            query=query,
            start_date=start_date,
            end_date=end_date,
            page_size=page_size,
            scroll_id=scroll_id,
            filters=filters,
        )

        search_request.additional_properties = d
        return search_request

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
