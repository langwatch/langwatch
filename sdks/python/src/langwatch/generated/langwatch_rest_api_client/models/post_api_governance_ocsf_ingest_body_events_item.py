from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_governance_ocsf_ingest_body_events_item_metadata import (
        PostApiGovernanceOcsfIngestBodyEventsItemMetadata,
    )


T = TypeVar("T", bound="PostApiGovernanceOcsfIngestBodyEventsItem")


@_attrs_define
class PostApiGovernanceOcsfIngestBodyEventsItem:
    """
    Attributes:
        class_uid (int):
        severity_id (int):
        time (int):
        metadata (PostApiGovernanceOcsfIngestBodyEventsItemMetadata):
        category_uid (int | Unset):
        activity_id (int | Unset):
        type_uid (int | Unset):
    """

    class_uid: int
    severity_id: int
    time: int
    metadata: PostApiGovernanceOcsfIngestBodyEventsItemMetadata
    category_uid: int | Unset = UNSET
    activity_id: int | Unset = UNSET
    type_uid: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        class_uid = self.class_uid

        severity_id = self.severity_id

        time = self.time

        metadata = self.metadata.to_dict()

        category_uid = self.category_uid

        activity_id = self.activity_id

        type_uid = self.type_uid

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "class_uid": class_uid,
                "severity_id": severity_id,
                "time": time,
                "metadata": metadata,
            }
        )
        if category_uid is not UNSET:
            field_dict["category_uid"] = category_uid
        if activity_id is not UNSET:
            field_dict["activity_id"] = activity_id
        if type_uid is not UNSET:
            field_dict["type_uid"] = type_uid

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_governance_ocsf_ingest_body_events_item_metadata import (
            PostApiGovernanceOcsfIngestBodyEventsItemMetadata,
        )

        d = dict(src_dict)
        class_uid = d.pop("class_uid")

        severity_id = d.pop("severity_id")

        time = d.pop("time")

        metadata = PostApiGovernanceOcsfIngestBodyEventsItemMetadata.from_dict(d.pop("metadata"))

        category_uid = d.pop("category_uid", UNSET)

        activity_id = d.pop("activity_id", UNSET)

        type_uid = d.pop("type_uid", UNSET)

        post_api_governance_ocsf_ingest_body_events_item = cls(
            class_uid=class_uid,
            severity_id=severity_id,
            time=time,
            metadata=metadata,
            category_uid=category_uid,
            activity_id=activity_id,
            type_uid=type_uid,
        )

        post_api_governance_ocsf_ingest_body_events_item.additional_properties = d
        return post_api_governance_ocsf_ingest_body_events_item

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
