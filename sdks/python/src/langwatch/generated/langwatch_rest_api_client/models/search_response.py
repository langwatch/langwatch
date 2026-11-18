from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.search_response_pagination import SearchResponsePagination
    from ..models.trace import Trace


T = TypeVar("T", bound="SearchResponse")


@_attrs_define
class SearchResponse:
    """
    Attributes:
        traces (list[Trace]):
        pagination (SearchResponsePagination):
    """

    traces: list[Trace]
    pagination: SearchResponsePagination

    def to_dict(self) -> dict[str, Any]:
        traces = []
        for traces_item_data in self.traces:
            traces_item = traces_item_data.to_dict()
            traces.append(traces_item)

        pagination = self.pagination.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "traces": traces,
                "pagination": pagination,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.search_response_pagination import SearchResponsePagination
        from ..models.trace import Trace

        d = dict(src_dict)
        traces = []
        _traces = d.pop("traces")
        for traces_item_data in _traces:
            traces_item = Trace.from_dict(traces_item_data)

            traces.append(traces_item)

        pagination = SearchResponsePagination.from_dict(d.pop("pagination"))

        search_response = cls(
            traces=traces,
            pagination=pagination,
        )

        return search_response
