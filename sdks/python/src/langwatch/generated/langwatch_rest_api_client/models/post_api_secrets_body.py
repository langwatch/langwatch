from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiSecretsBody")


@_attrs_define
class PostApiSecretsBody:
    """
    Attributes:
        name (str):
        value (str):
        project_id (str | Unset):
    """

    name: str
    value: str
    project_id: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        value = self.value

        project_id = self.project_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "value": value,
            }
        )
        if project_id is not UNSET:
            field_dict["projectId"] = project_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        value = d.pop("value")

        project_id = d.pop("projectId", UNSET)

        post_api_secrets_body = cls(
            name=name,
            value=value,
            project_id=project_id,
        )

        return post_api_secrets_body
