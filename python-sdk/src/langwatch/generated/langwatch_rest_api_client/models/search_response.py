from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.pagination import Pagination
    from ..models.trace import Trace


T = TypeVar("T", bound="SearchResponse")


@_attrs_define
class SearchResponse:
    """
    Attributes:
        traces (Union[Unset, list['Trace']]):
        pagination (Union[Unset, Pagination]):
    """

    traces: Union[Unset, list["Trace"]] = UNSET
    pagination: Union[Unset, "Pagination"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        traces: Union[Unset, list[dict[str, Any]]] = UNSET
        if not isinstance(self.traces, Unset):
            traces = []
            for traces_item_data in self.traces:
                traces_item = traces_item_data.to_dict()
                traces.append(traces_item)

        pagination: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.pagination, Unset):
            pagination = self.pagination.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if traces is not UNSET:
            field_dict["traces"] = traces
        if pagination is not UNSET:
            field_dict["pagination"] = pagination

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.pagination import Pagination
        from ..models.trace import Trace

        d = dict(src_dict)
        traces = []
        _traces = d.pop("traces", UNSET)
        for traces_item_data in _traces or []:
            traces_item = Trace.from_dict(traces_item_data)

            traces.append(traces_item)

        _pagination = d.pop("pagination", UNSET)
        pagination: Union[Unset, Pagination]
        if isinstance(_pagination, Unset):
            pagination = UNSET
        else:
            pagination = Pagination.from_dict(_pagination)

        search_response = cls(
            traces=traces,
            pagination=pagination,
        )

        search_response.additional_properties = d
        return search_response

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
