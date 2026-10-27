from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiScenarioEventsBodyType0MetadataLangwatchCaller")


@_attrs_define
class PostApiScenarioEventsBodyType0MetadataLangwatchCaller:
    """
    Attributes:
        voice (str):
        interrupt_probability (float):
        effects (str):
    """

    voice: str
    interrupt_probability: float
    effects: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        voice = self.voice

        interrupt_probability = self.interrupt_probability

        effects = self.effects

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "voice": voice,
                "interruptProbability": interrupt_probability,
                "effects": effects,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        voice = d.pop("voice")

        interrupt_probability = d.pop("interruptProbability")

        effects = d.pop("effects")

        post_api_scenario_events_body_type_0_metadata_langwatch_caller = cls(
            voice=voice,
            interrupt_probability=interrupt_probability,
            effects=effects,
        )

        post_api_scenario_events_body_type_0_metadata_langwatch_caller.additional_properties = d
        return post_api_scenario_events_body_type_0_metadata_langwatch_caller

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
