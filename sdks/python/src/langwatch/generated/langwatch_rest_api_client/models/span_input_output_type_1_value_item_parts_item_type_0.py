from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="SpanInputOutputType1ValueItemPartsItemType0")


@_attrs_define
class SpanInputOutputType1ValueItemPartsItemType0:
    """
    Attributes:
        type_ (Literal['text']):
        text (str | Unset):
        content (str | Unset):
    """

    type_: Literal["text"]
    text: str | Unset = UNSET
    content: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        text = self.text

        content = self.content

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
            }
        )
        if text is not UNSET:
            field_dict["text"] = text
        if content is not UNSET:
            field_dict["content"] = content

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = cast(Literal["text"], d.pop("type"))
        if type_ != "text":
            raise ValueError(f"type must match const 'text', got '{type_}'")

        text = d.pop("text", UNSET)

        content = d.pop("content", UNSET)

        span_input_output_type_1_value_item_parts_item_type_0 = cls(
            type_=type_,
            text=text,
            content=content,
        )

        return span_input_output_type_1_value_item_parts_item_type_0
