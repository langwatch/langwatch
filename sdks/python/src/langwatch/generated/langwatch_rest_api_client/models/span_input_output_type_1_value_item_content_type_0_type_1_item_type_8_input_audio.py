from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="SpanInputOutputType1ValueItemContentType0Type1ItemType8InputAudio")


@_attrs_define
class SpanInputOutputType1ValueItemContentType0Type1ItemType8InputAudio:
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

    def to_dict(self) -> dict[str, Any]:
        data = self.data

        format_ = self.format_

        url = self.url

        mime_type = self.mime_type

        id = self.id

        field_dict: dict[str, Any] = {}

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

        span_input_output_type_1_value_item_content_type_0_type_1_item_type_8_input_audio = cls(
            data=data,
            format_=format_,
            url=url,
            mime_type=mime_type,
            id=id,
        )

        return span_input_output_type_1_value_item_content_type_0_type_1_item_type_8_input_audio
