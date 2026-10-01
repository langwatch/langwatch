from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="SpanInputOutputType1ValueItemContentType0Type1ItemType0")


@_attrs_define
class SpanInputOutputType1ValueItemContentType0Type1ItemType0:
    """
    Attributes:
        type_ (Literal['text']):
        text (str | Unset):
        content (str | Unset):
    """

    type_: Literal["text"]
    text: str | Unset = UNSET
    content: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        text = self.text

        content = self.content

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        span_input_output_type_1_value_item_content_type_0_type_1_item_type_0 = cls(
            type_=type_,
            text=text,
            content=content,
        )

        span_input_output_type_1_value_item_content_type_0_type_1_item_type_0.additional_properties = d
        return span_input_output_type_1_value_item_content_type_0_type_1_item_type_0

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
