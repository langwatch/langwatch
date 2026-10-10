from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType1")


@_attrs_define
class PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType1:
    """
    Attributes:
        type_ (Literal['tool_use']):
        id (str):
        name (str):
        input_ (Any):
    """

    type_: Literal["tool_use"]
    id: str
    name: str
    input_: Any
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        id = self.id

        name = self.name

        input_ = self.input_

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "id": id,
                "name": name,
                "input": input_,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = cast(Literal["tool_use"], d.pop("type"))
        if type_ != "tool_use":
            raise ValueError(f"type must match const 'tool_use', got '{type_}'")

        id = d.pop("id")

        name = d.pop("name")

        input_ = d.pop("input")

        post_api_scenario_events_body_type_2_messages_item_type_1_content_item_type_1 = cls(
            type_=type_,
            id=id,
            name=name,
            input_=input_,
        )

        post_api_scenario_events_body_type_2_messages_item_type_1_content_item_type_1.additional_properties = d
        return post_api_scenario_events_body_type_2_messages_item_type_1_content_item_type_1

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
