from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="CreateStoredObjectUploadBody")


@_attrs_define
class CreateStoredObjectUploadBody:
    """
    Attributes:
        project_id (str):
        purpose (str):
        filename (str):
        media_type (str):
        byte_length (int):
    """

    project_id: str
    purpose: str
    filename: str
    media_type: str
    byte_length: int

    def to_dict(self) -> dict[str, Any]:
        project_id = self.project_id

        purpose = self.purpose

        filename = self.filename

        media_type = self.media_type

        byte_length = self.byte_length

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "projectId": project_id,
                "purpose": purpose,
                "filename": filename,
                "mediaType": media_type,
                "byteLength": byte_length,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        project_id = d.pop("projectId")

        purpose = d.pop("purpose")

        filename = d.pop("filename")

        media_type = d.pop("mediaType")

        byte_length = d.pop("byteLength")

        create_stored_object_upload_body = cls(
            project_id=project_id,
            purpose=purpose,
            filename=filename,
            media_type=media_type,
            byte_length=byte_length,
        )

        return create_stored_object_upload_body
