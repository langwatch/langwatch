from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiSecretsBody")


@_attrs_define
class PostApiSecretsBody:
    """
    Attributes:
        project_id (str):
        name (str):
        value (str):
    """

    project_id: str
    name: str
    value: str

    def to_dict(self) -> dict[str, Any]:
        project_id = self.project_id

        name = self.name

        value = self.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "projectId": project_id,
                "name": name,
                "value": value,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        project_id = d.pop("projectId")

        name = d.pop("name")

        value = d.pop("value")

        post_api_secrets_body = cls(
            project_id=project_id,
            name=name,
            value=value,
        )

        return post_api_secrets_body
