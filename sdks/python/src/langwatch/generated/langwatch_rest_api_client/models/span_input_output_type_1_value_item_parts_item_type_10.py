from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="SpanInputOutputType1ValueItemPartsItemType10")


@_attrs_define
class SpanInputOutputType1ValueItemPartsItemType10:
    """
    Attributes:
        type_ (Literal['image']):
        image (str):
        media_type (str | Unset):
    """

    type_: Literal["image"]
    image: str
    media_type: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        image = self.image

        media_type = self.media_type

        field_dict: dict[str, Any] = {}

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

        span_input_output_type_1_value_item_parts_item_type_10 = cls(
            type_=type_,
            image=image,
            media_type=media_type,
        )

        return span_input_output_type_1_value_item_parts_item_type_10
