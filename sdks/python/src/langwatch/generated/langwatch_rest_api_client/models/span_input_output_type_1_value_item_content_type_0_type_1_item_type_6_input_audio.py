from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="SpanInputOutputType1ValueItemContentType0Type1ItemType6InputAudio")


@_attrs_define
class SpanInputOutputType1ValueItemContentType0Type1ItemType6InputAudio:
    """
    Attributes:
        data (str | Unset):
        format_ (str | Unset):
        url (str | Unset):
        mime_type (str | Unset):
        id (str | Unset):
    """

    data: str | Unset = UNSET
    format_: str | Unset = UNSET
    url: str | Unset = UNSET
    mime_type: str | Unset = UNSET
    id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        data = self.data

        format_ = self.format_

        url = self.url

        mime_type = self.mime_type

        id = self.id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if data is not UNSET:
            field_dict["data"] = data
        if format_ is not UNSET:
            field_dict["format"] = format_
        if url is not UNSET:
            field_dict["url"] = url
        if mime_type is not UNSET:
            field_dict["mimeType"] = mime_type
        if id is not UNSET:
            field_dict["id"] = id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        data = d.pop("data", UNSET)

        format_ = d.pop("format", UNSET)

        url = d.pop("url", UNSET)

        mime_type = d.pop("mimeType", UNSET)

        id = d.pop("id", UNSET)

        span_input_output_type_1_value_item_content_type_0_type_1_item_type_6_input_audio = cls(
            data=data,
            format_=format_,
            url=url,
            mime_type=mime_type,
            id=id,
        )

        span_input_output_type_1_value_item_content_type_0_type_1_item_type_6_input_audio.additional_properties = d
        return span_input_output_type_1_value_item_content_type_0_type_1_item_type_6_input_audio

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
