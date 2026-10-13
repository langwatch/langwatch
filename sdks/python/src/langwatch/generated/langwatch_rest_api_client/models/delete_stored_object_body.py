from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="DeleteStoredObjectBody")


@_attrs_define
class DeleteStoredObjectBody:
    """
    Attributes:
        project_id (str):
        idempotency_key (str):
    """

    project_id: str
    idempotency_key: str

    def to_dict(self) -> dict[str, Any]:
        project_id = self.project_id

        idempotency_key = self.idempotency_key

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "projectId": project_id,
                "idempotencyKey": idempotency_key,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        project_id = d.pop("projectId")

        idempotency_key = d.pop("idempotencyKey")

        delete_stored_object_body = cls(
            project_id=project_id,
            idempotency_key=idempotency_key,
        )

        return delete_stored_object_body
