from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_track_event_body_event_details import PostApiTrackEventBodyEventDetails
    from ..models.post_api_track_event_body_metrics import PostApiTrackEventBodyMetrics


T = TypeVar("T", bound="PostApiTrackEventBody")


@_attrs_define
class PostApiTrackEventBody:
    """
    Attributes:
        event_type (str):
        metrics (PostApiTrackEventBodyMetrics):
        trace_id (str):
        event_id (str | Unset):
        event_details (PostApiTrackEventBodyEventDetails | Unset):
        timestamp (float | Unset):
    """

    event_type: str
    metrics: PostApiTrackEventBodyMetrics
    trace_id: str
    event_id: str | Unset = UNSET
    event_details: PostApiTrackEventBodyEventDetails | Unset = UNSET
    timestamp: float | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        event_type = self.event_type

        metrics = self.metrics.to_dict()

        trace_id = self.trace_id

        event_id = self.event_id

        event_details: dict[str, Any] | Unset = UNSET
        if not isinstance(self.event_details, Unset):
            event_details = self.event_details.to_dict()

        timestamp = self.timestamp

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "event_type": event_type,
                "metrics": metrics,
                "trace_id": trace_id,
            }
        )
        if event_id is not UNSET:
            field_dict["event_id"] = event_id
        if event_details is not UNSET:
            field_dict["event_details"] = event_details
        if timestamp is not UNSET:
            field_dict["timestamp"] = timestamp

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_track_event_body_event_details import PostApiTrackEventBodyEventDetails
        from ..models.post_api_track_event_body_metrics import PostApiTrackEventBodyMetrics

        d = dict(src_dict)
        event_type = d.pop("event_type")

        metrics = PostApiTrackEventBodyMetrics.from_dict(d.pop("metrics"))

        trace_id = d.pop("trace_id")

        event_id = d.pop("event_id", UNSET)

        _event_details = d.pop("event_details", UNSET)
        event_details: PostApiTrackEventBodyEventDetails | Unset
        if isinstance(_event_details, Unset):
            event_details = UNSET
        else:
            event_details = PostApiTrackEventBodyEventDetails.from_dict(_event_details)

        timestamp = d.pop("timestamp", UNSET)

        post_api_track_event_body = cls(
            event_type=event_type,
            metrics=metrics,
            trace_id=trace_id,
            event_id=event_id,
            event_details=event_details,
            timestamp=timestamp,
        )

        post_api_track_event_body.additional_properties = d
        return post_api_track_event_body

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
