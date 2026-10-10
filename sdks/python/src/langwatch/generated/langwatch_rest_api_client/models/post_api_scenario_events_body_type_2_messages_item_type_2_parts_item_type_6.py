from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_6_input_audio import (
        PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType6InputAudio,
    )


T = TypeVar("T", bound="PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType6")


@_attrs_define
class PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType6:
    """
    Attributes:
        type_ (Literal['input_audio']):
        input_audio (PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType6InputAudio):
    """

    type_: Literal["input_audio"]
    input_audio: PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType6InputAudio
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        input_audio = self.input_audio.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "input_audio": input_audio,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_6_input_audio import (
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType6InputAudio,
        )

        d = dict(src_dict)
        type_ = cast(Literal["input_audio"], d.pop("type"))
        if type_ != "input_audio":
            raise ValueError(f"type must match const 'input_audio', got '{type_}'")

        input_audio = PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType6InputAudio.from_dict(
            d.pop("input_audio")
        )

        post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_6 = cls(
            type_=type_,
            input_audio=input_audio,
        )

        post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_6.additional_properties = d
        return post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_6

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
