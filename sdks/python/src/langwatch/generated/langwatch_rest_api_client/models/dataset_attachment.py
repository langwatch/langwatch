from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="DatasetAttachment")


@_attrs_define
class DatasetAttachment:
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

    def to_dict(self) -> dict[str, Any]:
        url = self.url

        name = self.name

        media_type = self.media_type

        size_bytes = self.size_bytes

        field_dict: dict[str, Any] = {}

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

        dataset_attachment = cls(
            url=url,
            name=name,
            media_type=media_type,
            size_bytes=size_bytes,
        )

        return dataset_attachment
