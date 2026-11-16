from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="SpanInputOutputType5")


@_attrs_define
class SpanInputOutputType5:
    """
    Attributes:
        type_ (Literal['raw']):
        value (str):
    """

    type_: Literal["raw"]
    value: str

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        value = self.value

        field_dict: dict[str, Any] = {}

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
        type_ = cast(Literal["raw"], d.pop("type"))
        if type_ != "raw":
            raise ValueError(f"type must match const 'raw', got '{type_}'")

        value = d.pop("value")

        span_input_output_type_5 = cls(
            type_=type_,
            value=value,
        )

        return span_input_output_type_5
