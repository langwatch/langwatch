from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiDatasetAttachmentsResponse200")


@_attrs_define
class PostApiDatasetAttachmentsResponse200:
    """
    Attributes:
        url (str): The value to write into the cell, and the address the file is served from.
        name (str): The file name the reference carries.
        media_type (str): The media type the file is stored under.
        size_bytes (float): The size of the stored file, in bytes.
    """

    url: str
    name: str
    media_type: str
    size_bytes: float
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        url = self.url

        name = self.name

        media_type = self.media_type

        size_bytes = self.size_bytes

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "url": url,
                "name": name,
                "mediaType": media_type,
                "sizeBytes": size_bytes,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        url = d.pop("url")

        name = d.pop("name")

        media_type = d.pop("mediaType")

        size_bytes = d.pop("sizeBytes")

        post_api_dataset_attachments_response_200 = cls(
            url=url,
            name=name,
            media_type=media_type,
            size_bytes=size_bytes,
        )

        post_api_dataset_attachments_response_200.additional_properties = d
        return post_api_dataset_attachments_response_200

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
