from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_tool_calls_item import (
        PostApiScenarioEventsBodyType2MessagesItemType2ToolCallsItem,
    )


T = TypeVar("T", bound="PostApiScenarioEventsBodyType2MessagesItemType2")


@_attrs_define
class PostApiScenarioEventsBodyType2MessagesItemType2:
    """
    Attributes:
        id (str):
        role (Literal['assistant']):
        content (Union[Unset, str]):
        name (Union[Unset, str]):
        tool_calls (Union[Unset, list['PostApiScenarioEventsBodyType2MessagesItemType2ToolCallsItem']]):
    """

    id: str
    role: Literal["assistant"]
    content: Union[Unset, str] = UNSET
    name: Union[Unset, str] = UNSET
    tool_calls: Union[Unset, list["PostApiScenarioEventsBodyType2MessagesItemType2ToolCallsItem"]] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        role = self.role

        content = self.content

        name = self.name

        tool_calls: Union[Unset, list[dict[str, Any]]] = UNSET
        if not isinstance(self.tool_calls, Unset):
            tool_calls = []
            for tool_calls_item_data in self.tool_calls:
                tool_calls_item = tool_calls_item_data.to_dict()
                tool_calls.append(tool_calls_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "role": role,
            }
        )
        if content is not UNSET:
            field_dict["content"] = content
        if name is not UNSET:
            field_dict["name"] = name
        if tool_calls is not UNSET:
            field_dict["toolCalls"] = tool_calls

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_tool_calls_item import (
            PostApiScenarioEventsBodyType2MessagesItemType2ToolCallsItem,
        )

        d = dict(src_dict)
        id = d.pop("id")

        role = cast(Literal["assistant"], d.pop("role"))
        if role != "assistant":
            raise ValueError(f"role must match const 'assistant', got '{role}'")

        content = d.pop("content", UNSET)

        name = d.pop("name", UNSET)

        tool_calls = []
        _tool_calls = d.pop("toolCalls", UNSET)
        for tool_calls_item_data in _tool_calls or []:
            tool_calls_item = PostApiScenarioEventsBodyType2MessagesItemType2ToolCallsItem.from_dict(
                tool_calls_item_data
            )

            tool_calls.append(tool_calls_item)

        post_api_scenario_events_body_type_2_messages_item_type_2 = cls(
            id=id,
            role=role,
            content=content,
            name=name,
            tool_calls=tool_calls,
        )

        post_api_scenario_events_body_type_2_messages_item_type_2.additional_properties = d
        return post_api_scenario_events_body_type_2_messages_item_type_2

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
