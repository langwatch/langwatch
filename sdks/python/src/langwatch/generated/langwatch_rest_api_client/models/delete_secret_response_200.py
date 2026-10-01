from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="DeleteSecretResponse200")


@_attrs_define
class DeleteSecretResponse200:
    """
    Attributes:
        id (str):
        deleted (bool):
    """

    id: str
    deleted: bool

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        deleted = self.deleted

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "deleted": deleted,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        deleted = d.pop("deleted")

        delete_secret_response_200 = cls(
            id=id,
            deleted=deleted,
        )

        return delete_secret_response_200
