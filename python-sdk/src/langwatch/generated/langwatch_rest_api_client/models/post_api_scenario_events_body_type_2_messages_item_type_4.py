from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiScenarioEventsBodyType2MessagesItemType4")


@_attrs_define
class PostApiScenarioEventsBodyType2MessagesItemType4:
    """
    Attributes:
        id (str):
        content (str):
        role (Literal['tool']):
        tool_call_id (str):
    """

    id: str
    content: str
    role: Literal["tool"]
    tool_call_id: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        content = self.content

        role = self.role

        tool_call_id = self.tool_call_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "content": content,
                "role": role,
                "toolCallId": tool_call_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        content = d.pop("content")

        role = cast(Literal["tool"], d.pop("role"))
        if role != "tool":
            raise ValueError(f"role must match const 'tool', got '{role}'")

        tool_call_id = d.pop("toolCallId")

        post_api_scenario_events_body_type_2_messages_item_type_4 = cls(
            id=id,
            content=content,
            role=role,
            tool_call_id=tool_call_id,
        )

        post_api_scenario_events_body_type_2_messages_item_type_4.additional_properties = d
        return post_api_scenario_events_body_type_2_messages_item_type_4

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
