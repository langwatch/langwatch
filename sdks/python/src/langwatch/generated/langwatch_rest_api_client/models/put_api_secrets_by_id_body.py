from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="PutApiSecretsByIdBody")


@_attrs_define
class PutApiSecretsByIdBody:
    """
    Attributes:
        value (str):
        project_id (str | Unset):
    """

    value: str
    project_id: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        value = self.value

        project_id = self.project_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "value": value,
            }
        )
        if project_id is not UNSET:
            field_dict["projectId"] = project_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        value = d.pop("value")

        project_id = d.pop("projectId", UNSET)

        put_api_secrets_by_id_body = cls(
            value=value,
            project_id=project_id,
        )

        return put_api_secrets_by_id_body
