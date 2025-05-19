from collections.abc import Mapping
from typing import Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="Pagination")


@_attrs_define
class Pagination:
    """
    Attributes:
        scroll_id (Union[Unset, str]):  Example: 123.
        total_hits (Union[Unset, int]):  Example: 1254.
    """

    scroll_id: Union[Unset, str] = UNSET
    total_hits: Union[Unset, int] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        scroll_id = self.scroll_id

        total_hits = self.total_hits

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if scroll_id is not UNSET:
            field_dict["scrollId"] = scroll_id
        if total_hits is not UNSET:
            field_dict["totalHits"] = total_hits

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        scroll_id = d.pop("scrollId", UNSET)

        total_hits = d.pop("totalHits", UNSET)

        pagination = cls(
            scroll_id=scroll_id,
            total_hits=total_hits,
        )

        pagination.additional_properties = d
        return pagination

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
