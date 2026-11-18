from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="SpanInputOutputType1ValueItemContentType0Type1ItemType12File")


@_attrs_define
class SpanInputOutputType1ValueItemContentType0Type1ItemType12File:
    """
    Attributes:
        file_data (str | Unset):
        file_id (str | Unset):
        filename (str | Unset):
    """

    file_data: str | Unset = UNSET
    file_id: str | Unset = UNSET
    filename: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        file_data = self.file_data

        file_id = self.file_id

        filename = self.filename

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if file_data is not UNSET:
            field_dict["file_data"] = file_data
        if file_id is not UNSET:
            field_dict["file_id"] = file_id
        if filename is not UNSET:
            field_dict["filename"] = filename

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        file_data = d.pop("file_data", UNSET)

        file_id = d.pop("file_id", UNSET)

        filename = d.pop("filename", UNSET)

        span_input_output_type_1_value_item_content_type_0_type_1_item_type_12_file = cls(
            file_data=file_data,
            file_id=file_id,
            filename=filename,
        )

        return span_input_output_type_1_value_item_content_type_0_type_1_item_type_12_file
