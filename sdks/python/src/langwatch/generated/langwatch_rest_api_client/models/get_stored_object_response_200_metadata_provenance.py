from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetStoredObjectResponse200MetadataProvenance")


@_attrs_define
class GetStoredObjectResponse200MetadataProvenance:
    """
    Attributes:
        purpose (str):
        owner_kind (str):
        owner_id (str):
    """

    purpose: str
    owner_kind: str
    owner_id: str

    def to_dict(self) -> dict[str, Any]:
        purpose = self.purpose

        owner_kind = self.owner_kind

        owner_id = self.owner_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "purpose": purpose,
                "ownerKind": owner_kind,
                "ownerId": owner_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        purpose = d.pop("purpose")

        owner_kind = d.pop("ownerKind")

        owner_id = d.pop("ownerId")

        get_stored_object_response_200_metadata_provenance = cls(
            purpose=purpose,
            owner_kind=owner_kind,
            owner_id=owner_id,
        )

        return get_stored_object_response_200_metadata_provenance
