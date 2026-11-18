from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="SpanInputOutputType0")


@_attrs_define
class SpanInputOutputType0:
    """
    Attributes:
        type_ (Literal['text']):
        value (str):
    """

    type_: Literal["text"]
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
        type_ = cast(Literal["text"], d.pop("type"))
        if type_ != "text":
            raise ValueError(f"type must match const 'text', got '{type_}'")

        value = d.pop("value")

        span_input_output_type_0 = cls(
            type_=type_,
            value=value,
        )

        return span_input_output_type_0
