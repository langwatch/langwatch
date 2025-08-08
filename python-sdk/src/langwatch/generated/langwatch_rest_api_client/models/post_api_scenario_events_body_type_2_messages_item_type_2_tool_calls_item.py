from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_tool_calls_item_function import (
        PostApiScenarioEventsBodyType2MessagesItemType2ToolCallsItemFunction,
    )


T = TypeVar("T", bound="PostApiScenarioEventsBodyType2MessagesItemType2ToolCallsItem")


@_attrs_define
class PostApiScenarioEventsBodyType2MessagesItemType2ToolCallsItem:
    """
    Attributes:
        id (str):
        type_ (Literal['function']):
        function (PostApiScenarioEventsBodyType2MessagesItemType2ToolCallsItemFunction):
    """

    id: str
    type_: Literal["function"]
    function: "PostApiScenarioEventsBodyType2MessagesItemType2ToolCallsItemFunction"
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        type_ = self.type_

        function = self.function.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "type": type_,
                "function": function,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_tool_calls_item_function import (
            PostApiScenarioEventsBodyType2MessagesItemType2ToolCallsItemFunction,
        )

        d = dict(src_dict)
        id = d.pop("id")

        type_ = cast(Literal["function"], d.pop("type"))
        if type_ != "function":
            raise ValueError(f"type must match const 'function', got '{type_}'")

        function = PostApiScenarioEventsBodyType2MessagesItemType2ToolCallsItemFunction.from_dict(d.pop("function"))

        post_api_scenario_events_body_type_2_messages_item_type_2_tool_calls_item = cls(
            id=id,
            type_=type_,
            function=function,
        )

        post_api_scenario_events_body_type_2_messages_item_type_2_tool_calls_item.additional_properties = d
        return post_api_scenario_events_body_type_2_messages_item_type_2_tool_calls_item

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
