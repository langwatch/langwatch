from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ScimCreateUserResponse201EmailsItem")


@_attrs_define
class ScimCreateUserResponse201EmailsItem:
    """
    Attributes:
        primary (bool):
        value (str):
        type_ (str):
    """

    primary: bool
    value: str
    type_: str

    def to_dict(self) -> dict[str, Any]:
        primary = self.primary

        value = self.value

        type_ = self.type_

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "primary": primary,
                "value": value,
                "type": type_,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        primary = d.pop("primary")

        value = d.pop("value")

        type_ = d.pop("type")

        scim_create_user_response_201_emails_item = cls(
            primary=primary,
            value=value,
            type_=type_,
        )

        return scim_create_user_response_201_emails_item
