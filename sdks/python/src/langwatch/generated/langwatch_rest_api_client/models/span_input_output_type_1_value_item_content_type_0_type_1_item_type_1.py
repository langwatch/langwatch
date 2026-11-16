from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="SpanInputOutputType1ValueItemContentType0Type1ItemType1")


@_attrs_define
class SpanInputOutputType1ValueItemContentType0Type1ItemType1:
    """
    Attributes:
        text (str):
    """

    text: str

    def to_dict(self) -> dict[str, Any]:
        text = self.text

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "text": text,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        text = d.pop("text")

        span_input_output_type_1_value_item_content_type_0_type_1_item_type_1 = cls(
            text=text,
        )

        return span_input_output_type_1_value_item_content_type_0_type_1_item_type_1
