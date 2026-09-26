from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="SpanInputOutputType1ValueItemPartsItemType7Source")


@_attrs_define
class SpanInputOutputType1ValueItemPartsItemType7Source:
    """
    Attributes:
        type_ (Literal['data'] | Literal['url']):
        value (str):
        mime_type (str | Unset):
    """

    type_: Literal["data"] | Literal["url"]
    value: str
    mime_type: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_: Literal["data"] | Literal["url"]
        type_ = self.type_

        value = self.value

        mime_type = self.mime_type

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "value": value,
            }
        )
        if mime_type is not UNSET:
            field_dict["mimeType"] = mime_type

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_type_(data: object) -> Literal["data"] | Literal["url"]:
            type_type_0 = cast(Literal["url"], data)
            if type_type_0 != "url":
                raise ValueError(f"type_type_0 must match const 'url', got '{type_type_0}'")
            return type_type_0
            type_type_1 = cast(Literal["data"], data)
            if type_type_1 != "data":
                raise ValueError(f"type_type_1 must match const 'data', got '{type_type_1}'")
            return type_type_1

        type_ = _parse_type_(d.pop("type"))

        value = d.pop("value")

        mime_type = d.pop("mimeType", UNSET)

        span_input_output_type_1_value_item_parts_item_type_7_source = cls(
            type_=type_,
            value=value,
            mime_type=mime_type,
        )

        span_input_output_type_1_value_item_parts_item_type_7_source.additional_properties = d
        return span_input_output_type_1_value_item_parts_item_type_7_source

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
