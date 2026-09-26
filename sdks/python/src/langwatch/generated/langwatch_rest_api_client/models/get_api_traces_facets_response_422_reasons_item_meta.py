from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiTracesFacetsResponse422ReasonsItemMeta")


@_attrs_define
class GetApiTracesFacetsResponse422ReasonsItemMeta:
    """
    Attributes:
        field (str | Unset):
        type_ (str | Unset):
        message (str | Unset):
        received (str | Unset):
        expected (list[str] | Unset):
    """

    field: str | Unset = UNSET
    type_: str | Unset = UNSET
    message: str | Unset = UNSET
    received: str | Unset = UNSET
    expected: list[str] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        field = self.field

        type_ = self.type_

        message = self.message

        received = self.received

        expected: list[str] | Unset = UNSET
        if not isinstance(self.expected, Unset):
            expected = self.expected

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if field is not UNSET:
            field_dict["field"] = field
        if type_ is not UNSET:
            field_dict["type"] = type_
        if message is not UNSET:
            field_dict["message"] = message
        if received is not UNSET:
            field_dict["received"] = received
        if expected is not UNSET:
            field_dict["expected"] = expected

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        field = d.pop("field", UNSET)

        type_ = d.pop("type", UNSET)

        message = d.pop("message", UNSET)

        received = d.pop("received", UNSET)

        expected = cast(list[str], d.pop("expected", UNSET))

        get_api_traces_facets_response_422_reasons_item_meta = cls(
            field=field,
            type_=type_,
            message=message,
            received=received,
            expected=expected,
        )

        get_api_traces_facets_response_422_reasons_item_meta.additional_properties = d
        return get_api_traces_facets_response_422_reasons_item_meta

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
