from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="SpanInputOutputType1ValueItemContentType0Type1ItemType9")


@_attrs_define
class SpanInputOutputType1ValueItemContentType0Type1ItemType9:
    """
    Attributes:
        type_ (Literal['file']):
        media_type (str):
        data (str | Unset):
        url (str | Unset):
        filename (str | Unset):
    """

    type_: Literal["file"]
    media_type: str
    data: str | Unset = UNSET
    url: str | Unset = UNSET
    filename: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        media_type = self.media_type

        data = self.data

        url = self.url

        filename = self.filename

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "mediaType": media_type,
            }
        )
        if data is not UNSET:
            field_dict["data"] = data
        if url is not UNSET:
            field_dict["url"] = url
        if filename is not UNSET:
            field_dict["filename"] = filename

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = cast(Literal["file"], d.pop("type"))
        if type_ != "file":
            raise ValueError(f"type must match const 'file', got '{type_}'")

        media_type = d.pop("mediaType")

        data = d.pop("data", UNSET)

        url = d.pop("url", UNSET)

        filename = d.pop("filename", UNSET)

        span_input_output_type_1_value_item_content_type_0_type_1_item_type_9 = cls(
            type_=type_,
            media_type=media_type,
            data=data,
            url=url,
            filename=filename,
        )

        span_input_output_type_1_value_item_content_type_0_type_1_item_type_9.additional_properties = d
        return span_input_output_type_1_value_item_content_type_0_type_1_item_type_9

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
