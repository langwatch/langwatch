from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="UpdateGrantBody")


@_attrs_define
class UpdateGrantBody:
    """
    Attributes:
        role_id (str):
    """

    role_id: str

    def to_dict(self) -> dict[str, Any]:
        role_id = self.role_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "roleId": role_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        role_id = d.pop("roleId")

        update_grant_body = cls(
            role_id=role_id,
        )

        return update_grant_body
