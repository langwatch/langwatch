from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_0 import (
        PostApiScenarioEventsBodyType2MessagesItemType0,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_1 import (
        PostApiScenarioEventsBodyType2MessagesItemType1,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2 import (
        PostApiScenarioEventsBodyType2MessagesItemType2,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_3 import (
        PostApiScenarioEventsBodyType2MessagesItemType3,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_4 import (
        PostApiScenarioEventsBodyType2MessagesItemType4,
    )


T = TypeVar("T", bound="PostApiScenarioEventsBodyType2")


@_attrs_define
class PostApiScenarioEventsBodyType2:
    """
    Attributes:
        type_ (Literal['SCENARIO_MESSAGE_SNAPSHOT']):
        timestamp (float):
        messages (list[Union['PostApiScenarioEventsBodyType2MessagesItemType0',
            'PostApiScenarioEventsBodyType2MessagesItemType1', 'PostApiScenarioEventsBodyType2MessagesItemType2',
            'PostApiScenarioEventsBodyType2MessagesItemType3', 'PostApiScenarioEventsBodyType2MessagesItemType4']]):
        batch_run_id (str):
        scenario_id (str):
        scenario_run_id (str):
        raw_event (Union[Unset, Any]):
        scenario_set_id (Union[Unset, str]):  Default: 'default'.
    """

    type_: Literal["SCENARIO_MESSAGE_SNAPSHOT"]
    timestamp: float
    messages: list[
        Union[
            "PostApiScenarioEventsBodyType2MessagesItemType0",
            "PostApiScenarioEventsBodyType2MessagesItemType1",
            "PostApiScenarioEventsBodyType2MessagesItemType2",
            "PostApiScenarioEventsBodyType2MessagesItemType3",
            "PostApiScenarioEventsBodyType2MessagesItemType4",
        ]
    ]
    batch_run_id: str
    scenario_id: str
    scenario_run_id: str
    raw_event: Union[Unset, Any] = UNSET
    scenario_set_id: Union[Unset, str] = "default"
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_0 import (
            PostApiScenarioEventsBodyType2MessagesItemType0,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_1 import (
            PostApiScenarioEventsBodyType2MessagesItemType1,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2 import (
            PostApiScenarioEventsBodyType2MessagesItemType2,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_3 import (
            PostApiScenarioEventsBodyType2MessagesItemType3,
        )

        type_ = self.type_

        timestamp = self.timestamp

        messages = []
        for messages_item_data in self.messages:
            messages_item: dict[str, Any]
            if isinstance(messages_item_data, PostApiScenarioEventsBodyType2MessagesItemType0):
                messages_item = messages_item_data.to_dict()
            elif isinstance(messages_item_data, PostApiScenarioEventsBodyType2MessagesItemType1):
                messages_item = messages_item_data.to_dict()
            elif isinstance(messages_item_data, PostApiScenarioEventsBodyType2MessagesItemType2):
                messages_item = messages_item_data.to_dict()
            elif isinstance(messages_item_data, PostApiScenarioEventsBodyType2MessagesItemType3):
                messages_item = messages_item_data.to_dict()
            else:
                messages_item = messages_item_data.to_dict()

            messages.append(messages_item)

        batch_run_id = self.batch_run_id

        scenario_id = self.scenario_id

        scenario_run_id = self.scenario_run_id

        raw_event = self.raw_event

        scenario_set_id = self.scenario_set_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "timestamp": timestamp,
                "messages": messages,
                "batchRunId": batch_run_id,
                "scenarioId": scenario_id,
                "scenarioRunId": scenario_run_id,
            }
        )
        if raw_event is not UNSET:
            field_dict["rawEvent"] = raw_event
        if scenario_set_id is not UNSET:
            field_dict["scenarioSetId"] = scenario_set_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_0 import (
            PostApiScenarioEventsBodyType2MessagesItemType0,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_1 import (
            PostApiScenarioEventsBodyType2MessagesItemType1,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2 import (
            PostApiScenarioEventsBodyType2MessagesItemType2,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_3 import (
            PostApiScenarioEventsBodyType2MessagesItemType3,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_4 import (
            PostApiScenarioEventsBodyType2MessagesItemType4,
        )

        d = dict(src_dict)
        type_ = cast(Literal["SCENARIO_MESSAGE_SNAPSHOT"], d.pop("type"))
        if type_ != "SCENARIO_MESSAGE_SNAPSHOT":
            raise ValueError(f"type must match const 'SCENARIO_MESSAGE_SNAPSHOT', got '{type_}'")

        timestamp = d.pop("timestamp")

        messages = []
        _messages = d.pop("messages")
        for messages_item_data in _messages:

            def _parse_messages_item(
                data: object,
            ) -> Union[
                "PostApiScenarioEventsBodyType2MessagesItemType0",
                "PostApiScenarioEventsBodyType2MessagesItemType1",
                "PostApiScenarioEventsBodyType2MessagesItemType2",
                "PostApiScenarioEventsBodyType2MessagesItemType3",
                "PostApiScenarioEventsBodyType2MessagesItemType4",
            ]:
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    messages_item_type_0 = PostApiScenarioEventsBodyType2MessagesItemType0.from_dict(data)

                    return messages_item_type_0
                except:  # noqa: E722
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    messages_item_type_1 = PostApiScenarioEventsBodyType2MessagesItemType1.from_dict(data)

                    return messages_item_type_1
                except:  # noqa: E722
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    messages_item_type_2 = PostApiScenarioEventsBodyType2MessagesItemType2.from_dict(data)

                    return messages_item_type_2
                except:  # noqa: E722
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    messages_item_type_3 = PostApiScenarioEventsBodyType2MessagesItemType3.from_dict(data)

                    return messages_item_type_3
                except:  # noqa: E722
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                messages_item_type_4 = PostApiScenarioEventsBodyType2MessagesItemType4.from_dict(data)

                return messages_item_type_4

            messages_item = _parse_messages_item(messages_item_data)

            messages.append(messages_item)

        batch_run_id = d.pop("batchRunId")

        scenario_id = d.pop("scenarioId")

        scenario_run_id = d.pop("scenarioRunId")

        raw_event = d.pop("rawEvent", UNSET)

        scenario_set_id = d.pop("scenarioSetId", UNSET)

        post_api_scenario_events_body_type_2 = cls(
            type_=type_,
            timestamp=timestamp,
            messages=messages,
            batch_run_id=batch_run_id,
            scenario_id=scenario_id,
            scenario_run_id=scenario_run_id,
            raw_event=raw_event,
            scenario_set_id=scenario_set_id,
        )

        post_api_scenario_events_body_type_2.additional_properties = d
        return post_api_scenario_events_body_type_2

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
