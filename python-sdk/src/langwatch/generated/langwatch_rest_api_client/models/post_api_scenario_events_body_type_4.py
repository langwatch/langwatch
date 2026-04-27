from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_scenario_events_body_type_4_message import PostApiScenarioEventsBodyType4Message


T = TypeVar("T", bound="PostApiScenarioEventsBodyType4")


@_attrs_define
class PostApiScenarioEventsBodyType4:
    """
    Attributes:
        type_ (Literal['SCENARIO_TEXT_MESSAGE_END']):
        timestamp (float):
        batch_run_id (str):
        scenario_id (str):
        scenario_run_id (str):
        message_id (str):
        role (str):
        raw_event (Any | Unset):
        scenario_set_id (str | Unset):  Default: 'default'.
        content (str | Unset):
        message (PostApiScenarioEventsBodyType4Message | Unset):
        trace_id (str | Unset):
        message_index (float | Unset):
    """

    type_: Literal["SCENARIO_TEXT_MESSAGE_END"]
    timestamp: float
    batch_run_id: str
    scenario_id: str
    scenario_run_id: str
    message_id: str
    role: str
    raw_event: Any | Unset = UNSET
    scenario_set_id: str | Unset = "default"
    content: str | Unset = UNSET
    message: PostApiScenarioEventsBodyType4Message | Unset = UNSET
    trace_id: str | Unset = UNSET
    message_index: float | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        timestamp = self.timestamp

        batch_run_id = self.batch_run_id

        scenario_id = self.scenario_id

        scenario_run_id = self.scenario_run_id

        message_id = self.message_id

        role = self.role

        raw_event = self.raw_event

        scenario_set_id = self.scenario_set_id

        content = self.content

        message: dict[str, Any] | Unset = UNSET
        if not isinstance(self.message, Unset):
            message = self.message.to_dict()

        trace_id = self.trace_id

        message_index = self.message_index

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "timestamp": timestamp,
                "batchRunId": batch_run_id,
                "scenarioId": scenario_id,
                "scenarioRunId": scenario_run_id,
                "messageId": message_id,
                "role": role,
            }
        )
        if raw_event is not UNSET:
            field_dict["rawEvent"] = raw_event
        if scenario_set_id is not UNSET:
            field_dict["scenarioSetId"] = scenario_set_id
        if content is not UNSET:
            field_dict["content"] = content
        if message is not UNSET:
            field_dict["message"] = message
        if trace_id is not UNSET:
            field_dict["traceId"] = trace_id
        if message_index is not UNSET:
            field_dict["messageIndex"] = message_index

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_scenario_events_body_type_4_message import PostApiScenarioEventsBodyType4Message

        d = dict(src_dict)
        type_ = cast(Literal["SCENARIO_TEXT_MESSAGE_END"], d.pop("type"))
        if type_ != "SCENARIO_TEXT_MESSAGE_END":
            raise ValueError(f"type must match const 'SCENARIO_TEXT_MESSAGE_END', got '{type_}'")

        timestamp = d.pop("timestamp")

        batch_run_id = d.pop("batchRunId")

        scenario_id = d.pop("scenarioId")

        scenario_run_id = d.pop("scenarioRunId")

        message_id = d.pop("messageId")

        role = d.pop("role")

        raw_event = d.pop("rawEvent", UNSET)

        scenario_set_id = d.pop("scenarioSetId", UNSET)

        content = d.pop("content", UNSET)

        _message = d.pop("message", UNSET)
        message: PostApiScenarioEventsBodyType4Message | Unset
        if isinstance(_message, Unset):
            message = UNSET
        else:
            message = PostApiScenarioEventsBodyType4Message.from_dict(_message)

        trace_id = d.pop("traceId", UNSET)

        message_index = d.pop("messageIndex", UNSET)

        post_api_scenario_events_body_type_4 = cls(
            type_=type_,
            timestamp=timestamp,
            batch_run_id=batch_run_id,
            scenario_id=scenario_id,
            scenario_run_id=scenario_run_id,
            message_id=message_id,
            role=role,
            raw_event=raw_event,
            scenario_set_id=scenario_set_id,
            content=content,
            message=message,
            trace_id=trace_id,
            message_index=message_index,
        )

        post_api_scenario_events_body_type_4.additional_properties = d
        return post_api_scenario_events_body_type_4

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
