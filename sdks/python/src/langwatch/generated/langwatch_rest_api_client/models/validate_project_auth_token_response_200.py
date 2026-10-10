from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ValidateProjectAuthTokenResponse200")


@_attrs_define
class ValidateProjectAuthTokenResponse200:
    """
    Attributes:
        project_slug (str):
    """

    project_slug: str

    def to_dict(self) -> dict[str, Any]:
        project_slug = self.project_slug

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "projectSlug": project_slug,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        project_slug = d.pop("projectSlug")

        validate_project_auth_token_response_200 = cls(
            project_slug=project_slug,
        )

        return validate_project_auth_token_response_200
