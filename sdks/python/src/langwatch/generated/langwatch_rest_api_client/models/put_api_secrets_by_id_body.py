from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PutApiSecretsByIdBody")


@_attrs_define
class PutApiSecretsByIdBody:
    """
    Attributes:
        project_id (str):
        value (str):
    """

    project_id: str
    value: str

    def to_dict(self) -> dict[str, Any]:
        project_id = self.project_id

        value = self.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "projectId": project_id,
                "value": value,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        project_id = d.pop("projectId")

        value = d.pop("value")

        put_api_secrets_by_id_body = cls(
            project_id=project_id,
            value=value,
        )

        return put_api_secrets_by_id_body
