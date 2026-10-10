from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="RevokeGrantResponse200")


@_attrs_define
class RevokeGrantResponse200:
    """
    Attributes:
        id (str):
        revoked (bool):
    """

    id: str
    revoked: bool

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        revoked = self.revoked

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "revoked": revoked,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        revoked = d.pop("revoked")

        revoke_grant_response_200 = cls(
            id=id,
            revoked=revoked,
        )

        return revoke_grant_response_200
