from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from dateutil.parser import isoparse

from ..models.get_stored_object_response_200_metadata_audiences_item import (
    GetStoredObjectResponse200MetadataAudiencesItem,
)
from ..models.get_stored_object_response_200_metadata_status import GetStoredObjectResponse200MetadataStatus
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_stored_object_response_200_metadata_provenance import GetStoredObjectResponse200MetadataProvenance


T = TypeVar("T", bound="GetStoredObjectResponse200Metadata")


@_attrs_define
class GetStoredObjectResponse200Metadata:
    """
    Attributes:
        project_id (str):
        id (str):
        sha256 (str):
        byte_length (int):
        media_type (str):
        media_type_verified (bool):
        status (GetStoredObjectResponse200MetadataStatus):
        audiences (list[GetStoredObjectResponse200MetadataAudiencesItem]):
        generation (int):
        provenance (GetStoredObjectResponse200MetadataProvenance):
        created_at (datetime.datetime):
        available_at (datetime.datetime | Unset):
        deleted_at (datetime.datetime | Unset):
    """

    project_id: str
    id: str
    sha256: str
    byte_length: int
    media_type: str
    media_type_verified: bool
    status: GetStoredObjectResponse200MetadataStatus
    audiences: list[GetStoredObjectResponse200MetadataAudiencesItem]
    generation: int
    provenance: GetStoredObjectResponse200MetadataProvenance
    created_at: datetime.datetime
    available_at: datetime.datetime | Unset = UNSET
    deleted_at: datetime.datetime | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        project_id = self.project_id

        id = self.id

        sha256 = self.sha256

        byte_length = self.byte_length

        media_type = self.media_type

        media_type_verified = self.media_type_verified

        status = self.status.value

        audiences = []
        for audiences_item_data in self.audiences:
            audiences_item = audiences_item_data.value
            audiences.append(audiences_item)

        generation = self.generation

        provenance = self.provenance.to_dict()

        created_at = self.created_at.isoformat()

        available_at: str | Unset = UNSET
        if not isinstance(self.available_at, Unset):
            available_at = self.available_at.isoformat()

        deleted_at: str | Unset = UNSET
        if not isinstance(self.deleted_at, Unset):
            deleted_at = self.deleted_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "projectId": project_id,
                "id": id,
                "sha256": sha256,
                "byteLength": byte_length,
                "mediaType": media_type,
                "mediaTypeVerified": media_type_verified,
                "status": status,
                "audiences": audiences,
                "generation": generation,
                "provenance": provenance,
                "createdAt": created_at,
            }
        )
        if available_at is not UNSET:
            field_dict["availableAt"] = available_at
        if deleted_at is not UNSET:
            field_dict["deletedAt"] = deleted_at

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_stored_object_response_200_metadata_provenance import (
            GetStoredObjectResponse200MetadataProvenance,
        )

        d = dict(src_dict)
        project_id = d.pop("projectId")

        id = d.pop("id")

        sha256 = d.pop("sha256")

        byte_length = d.pop("byteLength")

        media_type = d.pop("mediaType")

        media_type_verified = d.pop("mediaTypeVerified")

        status = GetStoredObjectResponse200MetadataStatus(d.pop("status"))

        audiences = []
        _audiences = d.pop("audiences")
        for audiences_item_data in _audiences:
            audiences_item = GetStoredObjectResponse200MetadataAudiencesItem(audiences_item_data)

            audiences.append(audiences_item)

        generation = d.pop("generation")

        provenance = GetStoredObjectResponse200MetadataProvenance.from_dict(d.pop("provenance"))

        created_at = isoparse(d.pop("createdAt"))

        _available_at = d.pop("availableAt", UNSET)
        available_at: datetime.datetime | Unset
        if isinstance(_available_at, Unset):
            available_at = UNSET
        else:
            available_at = isoparse(_available_at)

        _deleted_at = d.pop("deletedAt", UNSET)
        deleted_at: datetime.datetime | Unset
        if isinstance(_deleted_at, Unset):
            deleted_at = UNSET
        else:
            deleted_at = isoparse(_deleted_at)

        get_stored_object_response_200_metadata = cls(
            project_id=project_id,
            id=id,
            sha256=sha256,
            byte_length=byte_length,
            media_type=media_type,
            media_type_verified=media_type_verified,
            status=status,
            audiences=audiences,
            generation=generation,
            provenance=provenance,
            created_at=created_at,
            available_at=available_at,
            deleted_at=deleted_at,
        )

        return get_stored_object_response_200_metadata
