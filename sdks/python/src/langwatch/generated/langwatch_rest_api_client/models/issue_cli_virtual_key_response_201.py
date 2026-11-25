from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="IssueCliVirtualKeyResponse201")


@_attrs_define
class IssueCliVirtualKeyResponse201:
    """
    Attributes:
        id (str):
        secret (str):
        prefix (str):
    """

    id: str
    secret: str
    prefix: str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        secret = self.secret

        prefix = self.prefix

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "secret": secret,
                "prefix": prefix,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        secret = d.pop("secret")

        prefix = d.pop("prefix")

        issue_cli_virtual_key_response_201 = cls(
            id=id,
            secret=secret,
            prefix=prefix,
        )

        return issue_cli_virtual_key_response_201
