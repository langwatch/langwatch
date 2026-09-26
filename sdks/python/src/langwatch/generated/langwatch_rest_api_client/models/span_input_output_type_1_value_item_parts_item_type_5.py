from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="SpanInputOutputType1ValueItemPartsItemType5")


@_attrs_define
class SpanInputOutputType1ValueItemPartsItemType5:
    """
    Attributes:
        type_ (Literal['binary']):
        mime_type (str):
        data (str | Unset):
        url (str | Unset):
        id (str | Unset):
        filename (str | Unset):
    """

    type_: Literal["binary"]
    mime_type: str
    data: str | Unset = UNSET
    url: str | Unset = UNSET
    id: str | Unset = UNSET
    filename: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        mime_type = self.mime_type

        data = self.data

        url = self.url

        id = self.id

        filename = self.filename

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "mimeType": mime_type,
            }
        )
        if data is not UNSET:
            field_dict["data"] = data
        if url is not UNSET:
            field_dict["url"] = url
        if id is not UNSET:
            field_dict["id"] = id
        if filename is not UNSET:
            field_dict["filename"] = filename

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = cast(Literal["binary"], d.pop("type"))
        if type_ != "binary":
            raise ValueError(f"type must match const 'binary', got '{type_}'")

        mime_type = d.pop("mimeType")

        data = d.pop("data", UNSET)

        url = d.pop("url", UNSET)

        id = d.pop("id", UNSET)

        filename = d.pop("filename", UNSET)

        span_input_output_type_1_value_item_parts_item_type_5 = cls(
            type_=type_,
            mime_type=mime_type,
            data=data,
            url=url,
            id=id,
            filename=filename,
        )

        span_input_output_type_1_value_item_parts_item_type_5.additional_properties = d
        return span_input_output_type_1_value_item_parts_item_type_5

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
