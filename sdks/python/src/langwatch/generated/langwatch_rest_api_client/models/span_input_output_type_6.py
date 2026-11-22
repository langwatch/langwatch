from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="SpanInputOutputType6")


@_attrs_define
class SpanInputOutputType6:
    """
    Attributes:
        type_ (Literal['list']):
        value (list[Any]):
    """

    type_: Literal["list"]
    value: list[Any]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        value = self.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "value": value,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = cast(Literal["list"], d.pop("type"))
        if type_ != "list":
            raise ValueError(f"type must match const 'list', got '{type_}'")

        value = cast(list[Any], d.pop("value"))

        span_input_output_type_6 = cls(
            type_=type_,
            value=value,
        )

        span_input_output_type_6.additional_properties = d
        return span_input_output_type_6

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
