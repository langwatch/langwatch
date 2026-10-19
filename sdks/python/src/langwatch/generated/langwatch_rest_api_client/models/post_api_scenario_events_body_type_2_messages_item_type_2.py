from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_0 import (
        PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType0,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_1 import (
        PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType1,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_2 import (
        PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType2,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_3 import (
        PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType3,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_4 import (
        PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType4,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_5 import (
        PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType5,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_6 import (
        PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType6,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_7 import (
        PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType7,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_8 import (
        PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType8,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_9 import (
        PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType9,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_10 import (
        PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType10,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_function_call_type_0 import (
        PostApiScenarioEventsBodyType2MessagesItemType2FunctionCallType0,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_0 import (
        PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType0,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_1 import (
        PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType1,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_2 import (
        PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType2,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_3 import (
        PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType3,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_4 import (
        PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType4,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_5 import (
        PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType5,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_6 import (
        PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType6,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_7 import (
        PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType7,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_8 import (
        PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType8,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_9 import (
        PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType9,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_10 import (
        PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType10,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_tool_calls_type_0_item import (
        PostApiScenarioEventsBodyType2MessagesItemType2ToolCallsType0Item,
    )


T = TypeVar("T", bound="PostApiScenarioEventsBodyType2MessagesItemType2")


@_attrs_define
class PostApiScenarioEventsBodyType2MessagesItemType2:
    """
    Attributes:
        id (str | Unset):
        trace_id (str | Unset):
        role (Literal['assistant'] | Literal['developer'] | Literal['function'] | Literal['system'] | Literal['tool'] |
            Literal['unknown'] | Literal['user'] | Unset):
        content (list[PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType0 |
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType1 |
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType10 |
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType2 |
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType3 |
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType4 |
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType5 |
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType6 |
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType7 |
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType8 |
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType9] | None | str | Unset):
        parts (list[PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType0 |
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType1 |
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType10 |
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType2 |
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType3 |
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType4 |
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType5 |
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType6 |
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType7 |
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType8 |
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType9] | Unset):
        function_call (None | PostApiScenarioEventsBodyType2MessagesItemType2FunctionCallType0 | Unset):
        tool_calls (list[PostApiScenarioEventsBodyType2MessagesItemType2ToolCallsType0Item] | None | Unset):
        tool_call_id (None | str | Unset):
        name (None | str | Unset):
        reasoning_content (None | str | Unset):
    """

    id: str | Unset = UNSET
    trace_id: str | Unset = UNSET
    role: (
        Literal["assistant"]
        | Literal["developer"]
        | Literal["function"]
        | Literal["system"]
        | Literal["tool"]
        | Literal["unknown"]
        | Literal["user"]
        | Unset
    ) = UNSET
    content: (
        list[
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType0
            | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType1
            | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType10
            | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType2
            | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType3
            | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType4
            | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType5
            | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType6
            | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType7
            | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType8
            | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType9
        ]
        | None
        | str
        | Unset
    ) = UNSET
    parts: (
        list[
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType0
            | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType1
            | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType10
            | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType2
            | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType3
            | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType4
            | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType5
            | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType6
            | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType7
            | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType8
            | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType9
        ]
        | Unset
    ) = UNSET
    function_call: None | PostApiScenarioEventsBodyType2MessagesItemType2FunctionCallType0 | Unset = UNSET
    tool_calls: list[PostApiScenarioEventsBodyType2MessagesItemType2ToolCallsType0Item] | None | Unset = UNSET
    tool_call_id: None | str | Unset = UNSET
    name: None | str | Unset = UNSET
    reasoning_content: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_0 import (
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType0,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_1 import (
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType1,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_2 import (
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType2,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_3 import (
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType3,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_4 import (
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType4,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_5 import (
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType5,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_6 import (
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType6,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_7 import (
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType7,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_8 import (
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType8,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_9 import (
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType9,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_function_call_type_0 import (
            PostApiScenarioEventsBodyType2MessagesItemType2FunctionCallType0,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_0 import (
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType0,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_1 import (
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType1,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_2 import (
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType2,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_3 import (
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType3,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_4 import (
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType4,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_5 import (
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType5,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_6 import (
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType6,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_7 import (
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType7,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_8 import (
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType8,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_9 import (
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType9,
        )

        id = self.id

        trace_id = self.trace_id

        role: (
            Literal["assistant"]
            | Literal["developer"]
            | Literal["function"]
            | Literal["system"]
            | Literal["tool"]
            | Literal["unknown"]
            | Literal["user"]
            | Unset
        )
        if isinstance(self.role, Unset):
            role = UNSET
        else:
            role = self.role

        content: list[dict[str, Any]] | None | str | Unset
        if isinstance(self.content, Unset):
            content = UNSET
        elif isinstance(self.content, list):
            content = []
            for content_type_0_type_1_item_data in self.content:
                content_type_0_type_1_item: dict[str, Any]
                if isinstance(
                    content_type_0_type_1_item_data,
                    PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType0,
                ):
                    content_type_0_type_1_item = content_type_0_type_1_item_data.to_dict()
                elif isinstance(
                    content_type_0_type_1_item_data,
                    PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType1,
                ):
                    content_type_0_type_1_item = content_type_0_type_1_item_data.to_dict()
                elif isinstance(
                    content_type_0_type_1_item_data,
                    PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType2,
                ):
                    content_type_0_type_1_item = content_type_0_type_1_item_data.to_dict()
                elif isinstance(
                    content_type_0_type_1_item_data,
                    PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType3,
                ):
                    content_type_0_type_1_item = content_type_0_type_1_item_data.to_dict()
                elif isinstance(
                    content_type_0_type_1_item_data,
                    PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType4,
                ):
                    content_type_0_type_1_item = content_type_0_type_1_item_data.to_dict()
                elif isinstance(
                    content_type_0_type_1_item_data,
                    PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType5,
                ):
                    content_type_0_type_1_item = content_type_0_type_1_item_data.to_dict()
                elif isinstance(
                    content_type_0_type_1_item_data,
                    PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType6,
                ):
                    content_type_0_type_1_item = content_type_0_type_1_item_data.to_dict()
                elif isinstance(
                    content_type_0_type_1_item_data,
                    PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType7,
                ):
                    content_type_0_type_1_item = content_type_0_type_1_item_data.to_dict()
                elif isinstance(
                    content_type_0_type_1_item_data,
                    PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType8,
                ):
                    content_type_0_type_1_item = content_type_0_type_1_item_data.to_dict()
                elif isinstance(
                    content_type_0_type_1_item_data,
                    PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType9,
                ):
                    content_type_0_type_1_item = content_type_0_type_1_item_data.to_dict()
                else:
                    content_type_0_type_1_item = content_type_0_type_1_item_data.to_dict()

                content.append(content_type_0_type_1_item)

        else:
            content = self.content

        parts: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.parts, Unset):
            parts = []
            for parts_item_data in self.parts:
                parts_item: dict[str, Any]
                if isinstance(parts_item_data, PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType0):
                    parts_item = parts_item_data.to_dict()
                elif isinstance(parts_item_data, PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType1):
                    parts_item = parts_item_data.to_dict()
                elif isinstance(parts_item_data, PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType2):
                    parts_item = parts_item_data.to_dict()
                elif isinstance(parts_item_data, PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType3):
                    parts_item = parts_item_data.to_dict()
                elif isinstance(parts_item_data, PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType4):
                    parts_item = parts_item_data.to_dict()
                elif isinstance(parts_item_data, PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType5):
                    parts_item = parts_item_data.to_dict()
                elif isinstance(parts_item_data, PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType6):
                    parts_item = parts_item_data.to_dict()
                elif isinstance(parts_item_data, PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType7):
                    parts_item = parts_item_data.to_dict()
                elif isinstance(parts_item_data, PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType8):
                    parts_item = parts_item_data.to_dict()
                elif isinstance(parts_item_data, PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType9):
                    parts_item = parts_item_data.to_dict()
                else:
                    parts_item = parts_item_data.to_dict()

                parts.append(parts_item)

        function_call: dict[str, Any] | None | Unset
        if isinstance(self.function_call, Unset):
            function_call = UNSET
        elif isinstance(self.function_call, PostApiScenarioEventsBodyType2MessagesItemType2FunctionCallType0):
            function_call = self.function_call.to_dict()
        else:
            function_call = self.function_call

        tool_calls: list[dict[str, Any]] | None | Unset
        if isinstance(self.tool_calls, Unset):
            tool_calls = UNSET
        elif isinstance(self.tool_calls, list):
            tool_calls = []
            for tool_calls_type_0_item_data in self.tool_calls:
                tool_calls_type_0_item = tool_calls_type_0_item_data.to_dict()
                tool_calls.append(tool_calls_type_0_item)

        else:
            tool_calls = self.tool_calls

        tool_call_id: None | str | Unset
        if isinstance(self.tool_call_id, Unset):
            tool_call_id = UNSET
        else:
            tool_call_id = self.tool_call_id

        name: None | str | Unset
        if isinstance(self.name, Unset):
            name = UNSET
        else:
            name = self.name

        reasoning_content: None | str | Unset
        if isinstance(self.reasoning_content, Unset):
            reasoning_content = UNSET
        else:
            reasoning_content = self.reasoning_content

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if id is not UNSET:
            field_dict["id"] = id
        if trace_id is not UNSET:
            field_dict["trace_id"] = trace_id
        if role is not UNSET:
            field_dict["role"] = role
        if content is not UNSET:
            field_dict["content"] = content
        if parts is not UNSET:
            field_dict["parts"] = parts
        if function_call is not UNSET:
            field_dict["function_call"] = function_call
        if tool_calls is not UNSET:
            field_dict["tool_calls"] = tool_calls
        if tool_call_id is not UNSET:
            field_dict["tool_call_id"] = tool_call_id
        if name is not UNSET:
            field_dict["name"] = name
        if reasoning_content is not UNSET:
            field_dict["reasoning_content"] = reasoning_content

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_0 import (
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType0,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_1 import (
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType1,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_2 import (
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType2,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_3 import (
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType3,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_4 import (
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType4,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_5 import (
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType5,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_6 import (
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType6,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_7 import (
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType7,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_8 import (
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType8,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_9 import (
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType9,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_content_type_0_type_1_item_type_10 import (
            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType10,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_function_call_type_0 import (
            PostApiScenarioEventsBodyType2MessagesItemType2FunctionCallType0,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_0 import (
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType0,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_1 import (
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType1,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_2 import (
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType2,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_3 import (
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType3,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_4 import (
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType4,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_5 import (
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType5,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_6 import (
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType6,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_7 import (
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType7,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_8 import (
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType8,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_9 import (
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType9,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_10 import (
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType10,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_tool_calls_type_0_item import (
            PostApiScenarioEventsBodyType2MessagesItemType2ToolCallsType0Item,
        )

        d = dict(src_dict)
        id = d.pop("id", UNSET)

        trace_id = d.pop("trace_id", UNSET)

        def _parse_role(
            data: object,
        ) -> (
            Literal["assistant"]
            | Literal["developer"]
            | Literal["function"]
            | Literal["system"]
            | Literal["tool"]
            | Literal["unknown"]
            | Literal["user"]
            | Unset
        ):
            if isinstance(data, Unset):
                return data
            role_type_0 = cast(Literal["system"], data)
            if role_type_0 != "system":
                raise ValueError(f"role_type_0 must match const 'system', got '{role_type_0}'")
            return role_type_0
            role_type_1 = cast(Literal["developer"], data)
            if role_type_1 != "developer":
                raise ValueError(f"role_type_1 must match const 'developer', got '{role_type_1}'")
            return role_type_1
            role_type_2 = cast(Literal["user"], data)
            if role_type_2 != "user":
                raise ValueError(f"role_type_2 must match const 'user', got '{role_type_2}'")
            return role_type_2
            role_type_3 = cast(Literal["assistant"], data)
            if role_type_3 != "assistant":
                raise ValueError(f"role_type_3 must match const 'assistant', got '{role_type_3}'")
            return role_type_3
            role_type_4 = cast(Literal["function"], data)
            if role_type_4 != "function":
                raise ValueError(f"role_type_4 must match const 'function', got '{role_type_4}'")
            return role_type_4
            role_type_5 = cast(Literal["tool"], data)
            if role_type_5 != "tool":
                raise ValueError(f"role_type_5 must match const 'tool', got '{role_type_5}'")
            return role_type_5
            role_type_6 = cast(Literal["unknown"], data)
            if role_type_6 != "unknown":
                raise ValueError(f"role_type_6 must match const 'unknown', got '{role_type_6}'")
            return role_type_6

        role = _parse_role(d.pop("role", UNSET))

        def _parse_content(
            data: object,
        ) -> (
            list[
                PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType0
                | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType1
                | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType10
                | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType2
                | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType3
                | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType4
                | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType5
                | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType6
                | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType7
                | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType8
                | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType9
            ]
            | None
            | str
            | Unset
        ):
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                content_type_0_type_1 = []
                _content_type_0_type_1 = data
                for content_type_0_type_1_item_data in _content_type_0_type_1:

                    def _parse_content_type_0_type_1_item(
                        data: object,
                    ) -> (
                        PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType0
                        | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType1
                        | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType10
                        | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType2
                        | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType3
                        | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType4
                        | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType5
                        | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType6
                        | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType7
                        | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType8
                        | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType9
                    ):
                        try:
                            if not isinstance(data, dict):
                                raise TypeError()
                            content_type_0_type_1_item_type_0 = (
                                PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType0.from_dict(
                                    data
                                )
                            )

                            return content_type_0_type_1_item_type_0
                        except (TypeError, ValueError, AttributeError, KeyError):
                            pass
                        try:
                            if not isinstance(data, dict):
                                raise TypeError()
                            content_type_0_type_1_item_type_1 = (
                                PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType1.from_dict(
                                    data
                                )
                            )

                            return content_type_0_type_1_item_type_1
                        except (TypeError, ValueError, AttributeError, KeyError):
                            pass
                        try:
                            if not isinstance(data, dict):
                                raise TypeError()
                            content_type_0_type_1_item_type_2 = (
                                PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType2.from_dict(
                                    data
                                )
                            )

                            return content_type_0_type_1_item_type_2
                        except (TypeError, ValueError, AttributeError, KeyError):
                            pass
                        try:
                            if not isinstance(data, dict):
                                raise TypeError()
                            content_type_0_type_1_item_type_3 = (
                                PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType3.from_dict(
                                    data
                                )
                            )

                            return content_type_0_type_1_item_type_3
                        except (TypeError, ValueError, AttributeError, KeyError):
                            pass
                        try:
                            if not isinstance(data, dict):
                                raise TypeError()
                            content_type_0_type_1_item_type_4 = (
                                PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType4.from_dict(
                                    data
                                )
                            )

                            return content_type_0_type_1_item_type_4
                        except (TypeError, ValueError, AttributeError, KeyError):
                            pass
                        try:
                            if not isinstance(data, dict):
                                raise TypeError()
                            content_type_0_type_1_item_type_5 = (
                                PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType5.from_dict(
                                    data
                                )
                            )

                            return content_type_0_type_1_item_type_5
                        except (TypeError, ValueError, AttributeError, KeyError):
                            pass
                        try:
                            if not isinstance(data, dict):
                                raise TypeError()
                            content_type_0_type_1_item_type_6 = (
                                PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType6.from_dict(
                                    data
                                )
                            )

                            return content_type_0_type_1_item_type_6
                        except (TypeError, ValueError, AttributeError, KeyError):
                            pass
                        try:
                            if not isinstance(data, dict):
                                raise TypeError()
                            content_type_0_type_1_item_type_7 = (
                                PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType7.from_dict(
                                    data
                                )
                            )

                            return content_type_0_type_1_item_type_7
                        except (TypeError, ValueError, AttributeError, KeyError):
                            pass
                        try:
                            if not isinstance(data, dict):
                                raise TypeError()
                            content_type_0_type_1_item_type_8 = (
                                PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType8.from_dict(
                                    data
                                )
                            )

                            return content_type_0_type_1_item_type_8
                        except (TypeError, ValueError, AttributeError, KeyError):
                            pass
                        try:
                            if not isinstance(data, dict):
                                raise TypeError()
                            content_type_0_type_1_item_type_9 = (
                                PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType9.from_dict(
                                    data
                                )
                            )

                            return content_type_0_type_1_item_type_9
                        except (TypeError, ValueError, AttributeError, KeyError):
                            pass
                        if not isinstance(data, dict):
                            raise TypeError()
                        content_type_0_type_1_item_type_10 = (
                            PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType10.from_dict(data)
                        )

                        return content_type_0_type_1_item_type_10

                    content_type_0_type_1_item = _parse_content_type_0_type_1_item(content_type_0_type_1_item_data)

                    content_type_0_type_1.append(content_type_0_type_1_item)

                return content_type_0_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                list[
                    PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType0
                    | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType1
                    | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType10
                    | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType2
                    | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType3
                    | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType4
                    | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType5
                    | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType6
                    | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType7
                    | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType8
                    | PostApiScenarioEventsBodyType2MessagesItemType2ContentType0Type1ItemType9
                ]
                | None
                | str
                | Unset,
                data,
            )

        content = _parse_content(d.pop("content", UNSET))

        _parts = d.pop("parts", UNSET)
        parts: (
            list[
                PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType0
                | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType1
                | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType10
                | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType2
                | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType3
                | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType4
                | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType5
                | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType6
                | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType7
                | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType8
                | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType9
            ]
            | Unset
        ) = UNSET
        if _parts is not UNSET:
            parts = []
            for parts_item_data in _parts:

                def _parse_parts_item(
                    data: object,
                ) -> (
                    PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType0
                    | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType1
                    | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType10
                    | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType2
                    | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType3
                    | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType4
                    | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType5
                    | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType6
                    | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType7
                    | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType8
                    | PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType9
                ):
                    try:
                        if not isinstance(data, dict):
                            raise TypeError()
                        parts_item_type_0 = PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType0.from_dict(
                            data
                        )

                        return parts_item_type_0
                    except (TypeError, ValueError, AttributeError, KeyError):
                        pass
                    try:
                        if not isinstance(data, dict):
                            raise TypeError()
                        parts_item_type_1 = PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType1.from_dict(
                            data
                        )

                        return parts_item_type_1
                    except (TypeError, ValueError, AttributeError, KeyError):
                        pass
                    try:
                        if not isinstance(data, dict):
                            raise TypeError()
                        parts_item_type_2 = PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType2.from_dict(
                            data
                        )

                        return parts_item_type_2
                    except (TypeError, ValueError, AttributeError, KeyError):
                        pass
                    try:
                        if not isinstance(data, dict):
                            raise TypeError()
                        parts_item_type_3 = PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType3.from_dict(
                            data
                        )

                        return parts_item_type_3
                    except (TypeError, ValueError, AttributeError, KeyError):
                        pass
                    try:
                        if not isinstance(data, dict):
                            raise TypeError()
                        parts_item_type_4 = PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType4.from_dict(
                            data
                        )

                        return parts_item_type_4
                    except (TypeError, ValueError, AttributeError, KeyError):
                        pass
                    try:
                        if not isinstance(data, dict):
                            raise TypeError()
                        parts_item_type_5 = PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType5.from_dict(
                            data
                        )

                        return parts_item_type_5
                    except (TypeError, ValueError, AttributeError, KeyError):
                        pass
                    try:
                        if not isinstance(data, dict):
                            raise TypeError()
                        parts_item_type_6 = PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType6.from_dict(
                            data
                        )

                        return parts_item_type_6
                    except (TypeError, ValueError, AttributeError, KeyError):
                        pass
                    try:
                        if not isinstance(data, dict):
                            raise TypeError()
                        parts_item_type_7 = PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType7.from_dict(
                            data
                        )

                        return parts_item_type_7
                    except (TypeError, ValueError, AttributeError, KeyError):
                        pass
                    try:
                        if not isinstance(data, dict):
                            raise TypeError()
                        parts_item_type_8 = PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType8.from_dict(
                            data
                        )

                        return parts_item_type_8
                    except (TypeError, ValueError, AttributeError, KeyError):
                        pass
                    try:
                        if not isinstance(data, dict):
                            raise TypeError()
                        parts_item_type_9 = PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType9.from_dict(
                            data
                        )

                        return parts_item_type_9
                    except (TypeError, ValueError, AttributeError, KeyError):
                        pass
                    if not isinstance(data, dict):
                        raise TypeError()
                    parts_item_type_10 = PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType10.from_dict(data)

                    return parts_item_type_10

                parts_item = _parse_parts_item(parts_item_data)

                parts.append(parts_item)

        def _parse_function_call(
            data: object,
        ) -> None | PostApiScenarioEventsBodyType2MessagesItemType2FunctionCallType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                function_call_type_0 = PostApiScenarioEventsBodyType2MessagesItemType2FunctionCallType0.from_dict(data)

                return function_call_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PostApiScenarioEventsBodyType2MessagesItemType2FunctionCallType0 | Unset, data)

        function_call = _parse_function_call(d.pop("function_call", UNSET))

        def _parse_tool_calls(
            data: object,
        ) -> list[PostApiScenarioEventsBodyType2MessagesItemType2ToolCallsType0Item] | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                tool_calls_type_0 = []
                _tool_calls_type_0 = data
                for tool_calls_type_0_item_data in _tool_calls_type_0:
                    tool_calls_type_0_item = (
                        PostApiScenarioEventsBodyType2MessagesItemType2ToolCallsType0Item.from_dict(
                            tool_calls_type_0_item_data
                        )
                    )

                    tool_calls_type_0.append(tool_calls_type_0_item)

                return tool_calls_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[PostApiScenarioEventsBodyType2MessagesItemType2ToolCallsType0Item] | None | Unset, data)

        tool_calls = _parse_tool_calls(d.pop("tool_calls", UNSET))

        def _parse_tool_call_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        tool_call_id = _parse_tool_call_id(d.pop("tool_call_id", UNSET))

        def _parse_name(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        name = _parse_name(d.pop("name", UNSET))

        def _parse_reasoning_content(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        reasoning_content = _parse_reasoning_content(d.pop("reasoning_content", UNSET))

        post_api_scenario_events_body_type_2_messages_item_type_2 = cls(
            id=id,
            trace_id=trace_id,
            role=role,
            content=content,
            parts=parts,
            function_call=function_call,
            tool_calls=tool_calls,
            tool_call_id=tool_call_id,
            name=name,
            reasoning_content=reasoning_content,
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
