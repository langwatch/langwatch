from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ScimCreateUserResponse201Name")


@_attrs_define
class ScimCreateUserResponse201Name:
    """
    Attributes:
        given_name (str):
        family_name (str):
    """

    given_name: str
    family_name: str

    def to_dict(self) -> dict[str, Any]:
        given_name = self.given_name

        family_name = self.family_name

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "givenName": given_name,
                "familyName": family_name,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        given_name = d.pop("givenName")

        family_name = d.pop("familyName")

        scim_create_user_response_201_name = cls(
            given_name=given_name,
            family_name=family_name,
        )

        return scim_create_user_response_201_name
