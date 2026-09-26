from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_stored_object_response_200_capability import GetStoredObjectResponse200Capability
    from ..models.get_stored_object_response_200_metadata import GetStoredObjectResponse200Metadata


T = TypeVar("T", bound="GetStoredObjectResponse200")


@_attrs_define
class GetStoredObjectResponse200:
    """
    Attributes:
        metadata (GetStoredObjectResponse200Metadata):
        capability (GetStoredObjectResponse200Capability):
    """

    metadata: GetStoredObjectResponse200Metadata
    capability: GetStoredObjectResponse200Capability

    def to_dict(self) -> dict[str, Any]:
        metadata = self.metadata.to_dict()

        capability = self.capability.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "metadata": metadata,
                "capability": capability,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_stored_object_response_200_capability import GetStoredObjectResponse200Capability
        from ..models.get_stored_object_response_200_metadata import GetStoredObjectResponse200Metadata

        d = dict(src_dict)
        metadata = GetStoredObjectResponse200Metadata.from_dict(d.pop("metadata"))

        capability = GetStoredObjectResponse200Capability.from_dict(d.pop("capability"))

        get_stored_object_response_200 = cls(
            metadata=metadata,
            capability=capability,
        )

        return get_stored_object_response_200
