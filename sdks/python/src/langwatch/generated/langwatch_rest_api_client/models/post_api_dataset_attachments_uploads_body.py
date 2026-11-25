from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiDatasetAttachmentsUploadsBody")


@_attrs_define
class PostApiDatasetAttachmentsUploadsBody:
    """
    Attributes:
        filename (str): The file name the reference will carry.
        media_type (str): The media type of the file.
        byte_length (int): The size of the file, in bytes.
    """

    filename: str
    media_type: str
    byte_length: int
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        filename = self.filename

        media_type = self.media_type

        byte_length = self.byte_length

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "filename": filename,
                "mediaType": media_type,
                "byteLength": byte_length,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        filename = d.pop("filename")

        media_type = d.pop("mediaType")

        byte_length = d.pop("byteLength")

        post_api_dataset_attachments_uploads_body = cls(
            filename=filename,
            media_type=media_type,
            byte_length=byte_length,
        )

        post_api_dataset_attachments_uploads_body.additional_properties = d
        return post_api_dataset_attachments_uploads_body

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
