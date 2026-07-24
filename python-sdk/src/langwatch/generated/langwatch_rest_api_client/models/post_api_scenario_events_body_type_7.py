from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiScenarioEventsBodyType7")


@_attrs_define
class PostApiScenarioEventsBodyType7:
    """
    Attributes:
        type_ (Literal['SCENARIO_TOOL_CALL_ARGS']):
        timestamp (float):
        batch_run_id (str):
        scenario_id (str):
        scenario_run_id (str):
        tool_call_id (str):
        delta (str):
        raw_event (Any | Unset):
        scenario_set_id (str | Unset):  Default: 'default'.
    """

    type_: Literal["SCENARIO_TOOL_CALL_ARGS"]
    timestamp: float
    batch_run_id: str
    scenario_id: str
    scenario_run_id: str
    tool_call_id: str
    delta: str
    raw_event: Any | Unset = UNSET
    scenario_set_id: str | Unset = "default"
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        timestamp = self.timestamp

        batch_run_id = self.batch_run_id

        scenario_id = self.scenario_id

        scenario_run_id = self.scenario_run_id

        tool_call_id = self.tool_call_id

        delta = self.delta

        raw_event = self.raw_event

        scenario_set_id = self.scenario_set_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "timestamp": timestamp,
                "batchRunId": batch_run_id,
                "scenarioId": scenario_id,
                "scenarioRunId": scenario_run_id,
                "toolCallId": tool_call_id,
                "delta": delta,
            }
        )
        if raw_event is not UNSET:
            field_dict["rawEvent"] = raw_event
        if scenario_set_id is not UNSET:
            field_dict["scenarioSetId"] = scenario_set_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = cast(Literal["SCENARIO_TOOL_CALL_ARGS"], d.pop("type"))
        if type_ != "SCENARIO_TOOL_CALL_ARGS":
            raise ValueError(f"type must match const 'SCENARIO_TOOL_CALL_ARGS', got '{type_}'")

        timestamp = d.pop("timestamp")

        batch_run_id = d.pop("batchRunId")

        scenario_id = d.pop("scenarioId")

        scenario_run_id = d.pop("scenarioRunId")

        tool_call_id = d.pop("toolCallId")

        delta = d.pop("delta")

        raw_event = d.pop("rawEvent", UNSET)

        scenario_set_id = d.pop("scenarioSetId", UNSET)

        post_api_scenario_events_body_type_7 = cls(
            type_=type_,
            timestamp=timestamp,
            batch_run_id=batch_run_id,
            scenario_id=scenario_id,
            scenario_run_id=scenario_run_id,
            tool_call_id=tool_call_id,
            delta=delta,
            raw_event=raw_event,
            scenario_set_id=scenario_set_id,
        )

        post_api_scenario_events_body_type_7.additional_properties = d
        return post_api_scenario_events_body_type_7

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
