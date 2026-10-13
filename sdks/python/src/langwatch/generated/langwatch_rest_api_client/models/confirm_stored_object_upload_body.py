from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ConfirmStoredObjectUploadBody")


@_attrs_define
class ConfirmStoredObjectUploadBody:
    """
    Attributes:
        project_id (str):
    """

    project_id: str

    def to_dict(self) -> dict[str, Any]:
        project_id = self.project_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "projectId": project_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        project_id = d.pop("projectId")

        confirm_stored_object_upload_body = cls(
            project_id=project_id,
        )

        return confirm_stored_object_upload_body
