from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_scenario_events_body_type_2_messages_item_type_0_role import (
    PostApiScenarioEventsBodyType2MessagesItemType0Role,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.ag_ui_tool_call import AgUiToolCall
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_0_content_type_1_item import (
        PostApiScenarioEventsBodyType2MessagesItemType0ContentType1Item,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_0_content_type_2 import (
        PostApiScenarioEventsBodyType2MessagesItemType0ContentType2,
    )


T = TypeVar("T", bound="PostApiScenarioEventsBodyType2MessagesItemType0")


@_attrs_define
class PostApiScenarioEventsBodyType2MessagesItemType0:
    """
    Attributes:
        id (str):
        role (PostApiScenarioEventsBodyType2MessagesItemType0Role):
        trace_id (str | Unset):
        content (list[PostApiScenarioEventsBodyType2MessagesItemType0ContentType1Item] |
            PostApiScenarioEventsBodyType2MessagesItemType0ContentType2 | str | Unset):
        name (str | Unset):
        encrypted_value (str | Unset):
        tool_call_id (str | Unset):
        error (str | Unset):
        activity_type (str | Unset):
        toolCalls (list[AgUiToolCall] | Unset):
        tool_calls (list[AgUiToolCall] | Unset):
    """

    id: str
    role: PostApiScenarioEventsBodyType2MessagesItemType0Role
    trace_id: str | Unset = UNSET
    content: (
        list[PostApiScenarioEventsBodyType2MessagesItemType0ContentType1Item]
        | PostApiScenarioEventsBodyType2MessagesItemType0ContentType2
        | str
        | Unset
    ) = UNSET
    name: str | Unset = UNSET
    encrypted_value: str | Unset = UNSET
    tool_call_id: str | Unset = UNSET
    error: str | Unset = UNSET
    activity_type: str | Unset = UNSET
    toolCalls: list[AgUiToolCall] | Unset = UNSET
    tool_calls: list[AgUiToolCall] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_0_content_type_2 import (
            PostApiScenarioEventsBodyType2MessagesItemType0ContentType2,
        )

        id = self.id

        role = self.role.value

        trace_id = self.trace_id

        content: dict[str, Any] | list[dict[str, Any]] | str | Unset
        if isinstance(self.content, Unset):
            content = UNSET
        elif isinstance(self.content, list):
            content = []
            for content_type_1_item_data in self.content:
                content_type_1_item = content_type_1_item_data.to_dict()
                content.append(content_type_1_item)

        elif isinstance(self.content, PostApiScenarioEventsBodyType2MessagesItemType0ContentType2):
            content = self.content.to_dict()
        else:
            content = self.content

        name = self.name

        encrypted_value = self.encrypted_value

        tool_call_id = self.tool_call_id

        error = self.error

        activity_type = self.activity_type

        toolCalls: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.toolCalls, Unset):
            toolCalls = []
            for tool_calls_item_data in self.toolCalls:
                tool_calls_item = tool_calls_item_data.to_dict()
                toolCalls.append(tool_calls_item)

        tool_calls: list[dict[str, Any]] | Unset = UNSET
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
        if trace_id is not UNSET:
            field_dict["trace_id"] = trace_id
        if content is not UNSET:
            field_dict["content"] = content
        if name is not UNSET:
            field_dict["name"] = name
        if encrypted_value is not UNSET:
            field_dict["encryptedValue"] = encrypted_value
        if tool_call_id is not UNSET:
            field_dict["toolCallId"] = tool_call_id
        if error is not UNSET:
            field_dict["error"] = error
        if activity_type is not UNSET:
            field_dict["activityType"] = activity_type
        if toolCalls is not UNSET:
            field_dict["toolCalls"] = toolCalls
        if tool_calls is not UNSET:
            field_dict["tool_calls"] = tool_calls

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.ag_ui_tool_call import AgUiToolCall
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_0_content_type_1_item import (
            PostApiScenarioEventsBodyType2MessagesItemType0ContentType1Item,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_0_content_type_2 import (
            PostApiScenarioEventsBodyType2MessagesItemType0ContentType2,
        )

        d = dict(src_dict)
        id = d.pop("id")

        role = PostApiScenarioEventsBodyType2MessagesItemType0Role(d.pop("role"))

        trace_id = d.pop("trace_id", UNSET)

        def _parse_content(
            data: object,
        ) -> (
            list[PostApiScenarioEventsBodyType2MessagesItemType0ContentType1Item]
            | PostApiScenarioEventsBodyType2MessagesItemType0ContentType2
            | str
            | Unset
        ):
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                content_type_1 = []
                _content_type_1 = data
                for content_type_1_item_data in _content_type_1:
                    content_type_1_item = PostApiScenarioEventsBodyType2MessagesItemType0ContentType1Item.from_dict(
                        content_type_1_item_data
                    )

                    content_type_1.append(content_type_1_item)

                return content_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                content_type_2 = PostApiScenarioEventsBodyType2MessagesItemType0ContentType2.from_dict(data)

                return content_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                list[PostApiScenarioEventsBodyType2MessagesItemType0ContentType1Item]
                | PostApiScenarioEventsBodyType2MessagesItemType0ContentType2
                | str
                | Unset,
                data,
            )

        content = _parse_content(d.pop("content", UNSET))

        name = d.pop("name", UNSET)

        encrypted_value = d.pop("encryptedValue", UNSET)

        tool_call_id = d.pop("toolCallId", UNSET)

        error = d.pop("error", UNSET)

        activity_type = d.pop("activityType", UNSET)

        _toolCalls = d.pop("toolCalls", UNSET)
        toolCalls: list[AgUiToolCall] | Unset = UNSET
        if _toolCalls is not UNSET:
            toolCalls = []
            for tool_calls_item_data in _toolCalls:
                tool_calls_item = AgUiToolCall.from_dict(tool_calls_item_data)

                toolCalls.append(tool_calls_item)

        _tool_calls = d.pop("tool_calls", UNSET)
        tool_calls: list[AgUiToolCall] | Unset = UNSET
        if _tool_calls is not UNSET:
            tool_calls = []
            for tool_calls_item_data in _tool_calls:
                tool_calls_item = AgUiToolCall.from_dict(tool_calls_item_data)

                tool_calls.append(tool_calls_item)

        post_api_scenario_events_body_type_2_messages_item_type_0 = cls(
            id=id,
            role=role,
            trace_id=trace_id,
            content=content,
            name=name,
            encrypted_value=encrypted_value,
            tool_call_id=tool_call_id,
            error=error,
            activity_type=activity_type,
            toolCalls=toolCalls,
            tool_calls=tool_calls,
        )

        post_api_scenario_events_body_type_2_messages_item_type_0.additional_properties = d
        return post_api_scenario_events_body_type_2_messages_item_type_0

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
