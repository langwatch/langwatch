from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.trace_events_item_event_details import TraceEventsItemEventDetails
    from ..models.trace_events_item_metrics import TraceEventsItemMetrics
    from ..models.trace_events_item_timestamps import TraceEventsItemTimestamps


T = TypeVar("T", bound="TraceEventsItem")


@_attrs_define
class TraceEventsItem:
    """
    Attributes:
        event_id (str):
        event_type (str):
        project_id (str):
        metrics (TraceEventsItemMetrics):
        event_details (TraceEventsItemEventDetails):
        trace_id (str):
        timestamps (TraceEventsItemTimestamps):
    """

    event_id: str
    event_type: str
    project_id: str
    metrics: TraceEventsItemMetrics
    event_details: TraceEventsItemEventDetails
    trace_id: str
    timestamps: TraceEventsItemTimestamps
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        event_id = self.event_id

        event_type = self.event_type

        project_id = self.project_id

        metrics = self.metrics.to_dict()

        event_details = self.event_details.to_dict()

        trace_id = self.trace_id

        timestamps = self.timestamps.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "event_id": event_id,
                "event_type": event_type,
                "project_id": project_id,
                "metrics": metrics,
                "event_details": event_details,
                "trace_id": trace_id,
                "timestamps": timestamps,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.trace_events_item_event_details import TraceEventsItemEventDetails
        from ..models.trace_events_item_metrics import TraceEventsItemMetrics
        from ..models.trace_events_item_timestamps import TraceEventsItemTimestamps

        d = dict(src_dict)
        event_id = d.pop("event_id")

        event_type = d.pop("event_type")

        project_id = d.pop("project_id")

        metrics = TraceEventsItemMetrics.from_dict(d.pop("metrics"))

        event_details = TraceEventsItemEventDetails.from_dict(d.pop("event_details"))

        trace_id = d.pop("trace_id")

        timestamps = TraceEventsItemTimestamps.from_dict(d.pop("timestamps"))

        trace_events_item = cls(
            event_id=event_id,
            event_type=event_type,
            project_id=project_id,
            metrics=metrics,
            event_details=event_details,
            trace_id=trace_id,
            timestamps=timestamps,
        )

        trace_events_item.additional_properties = d
        return trace_events_item

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
