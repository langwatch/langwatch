from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="SpanInputOutputType1ValueItemContentType0Type1ItemType8")


@_attrs_define
class SpanInputOutputType1ValueItemContentType0Type1ItemType8:
    """
    Attributes:
        type_ (Literal['image']):
        image (str):
        media_type (str | Unset):
    """

    type_: Literal["image"]
    image: str
    media_type: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        image = self.image

        media_type = self.media_type

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "image": image,
            }
        )
        if media_type is not UNSET:
            field_dict["mediaType"] = media_type

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = cast(Literal["image"], d.pop("type"))
        if type_ != "image":
            raise ValueError(f"type must match const 'image', got '{type_}'")

        image = d.pop("image")

        media_type = d.pop("mediaType", UNSET)

        span_input_output_type_1_value_item_content_type_0_type_1_item_type_8 = cls(
            type_=type_,
            image=image,
            media_type=media_type,
        )

        span_input_output_type_1_value_item_content_type_0_type_1_item_type_8.additional_properties = d
        return span_input_output_type_1_value_item_content_type_0_type_1_item_type_8

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
