from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="RevokeDocsSessionResponse200")


@_attrs_define
class RevokeDocsSessionResponse200:
    """
    Attributes:
        revoked (bool):
    """

    revoked: bool

    def to_dict(self) -> dict[str, Any]:
        revoked = self.revoked

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "revoked": revoked,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        revoked = d.pop("revoked")

        revoke_docs_session_response_200 = cls(
            revoked=revoked,
        )

        return revoke_docs_session_response_200
