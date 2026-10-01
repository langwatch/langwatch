from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.confirm_stored_object_upload_response_200_audience import ConfirmStoredObjectUploadResponse200Audience

T = TypeVar("T", bound="ConfirmStoredObjectUploadResponse200")


@_attrs_define
class ConfirmStoredObjectUploadResponse200:
    """
    Attributes:
        project_id (str):
        id (str):
        sha256 (str):
        byte_length (int):
        filename (str):
        media_type (str):
        audience (ConfirmStoredObjectUploadResponse200Audience):
    """

    project_id: str
    id: str
    sha256: str
    byte_length: int
    filename: str
    media_type: str
    audience: ConfirmStoredObjectUploadResponse200Audience

    def to_dict(self) -> dict[str, Any]:
        project_id = self.project_id

        id = self.id

        sha256 = self.sha256

        byte_length = self.byte_length

        filename = self.filename

        media_type = self.media_type

        audience = self.audience.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "projectId": project_id,
                "id": id,
                "sha256": sha256,
                "byteLength": byte_length,
                "filename": filename,
                "mediaType": media_type,
                "audience": audience,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        project_id = d.pop("projectId")

        id = d.pop("id")

        sha256 = d.pop("sha256")

        byte_length = d.pop("byteLength")

        filename = d.pop("filename")

        media_type = d.pop("mediaType")

        audience = ConfirmStoredObjectUploadResponse200Audience(d.pop("audience"))

        confirm_stored_object_upload_response_200 = cls(
            project_id=project_id,
            id=id,
            sha256=sha256,
            byte_length=byte_length,
            filename=filename,
            media_type=media_type,
            audience=audience,
        )

        return confirm_stored_object_upload_response_200
