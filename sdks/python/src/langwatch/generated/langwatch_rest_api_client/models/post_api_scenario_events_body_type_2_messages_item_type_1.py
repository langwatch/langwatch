from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_1_content_item_type_0 import (
        PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType0,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_1_content_item_type_1 import (
        PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType1,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_1_content_item_type_2 import (
        PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType2,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_1_content_item_type_3 import (
        PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType3,
    )
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_1_content_item_type_4 import (
        PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType4,
    )


T = TypeVar("T", bound="PostApiScenarioEventsBodyType2MessagesItemType1")


@_attrs_define
class PostApiScenarioEventsBodyType2MessagesItemType1:
    """
    Attributes:
        content (list[PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType0 |
            PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType1 |
            PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType2 |
            PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType3 |
            PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType4]):
        id (str | Unset):
        trace_id (str | Unset):
        role (str | Unset):
    """

    content: list[
        PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType0
        | PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType1
        | PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType2
        | PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType3
        | PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType4
    ]
    id: str | Unset = UNSET
    trace_id: str | Unset = UNSET
    role: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_1_content_item_type_0 import (
            PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType0,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_1_content_item_type_1 import (
            PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType1,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_1_content_item_type_2 import (
            PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType2,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_1_content_item_type_3 import (
            PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType3,
        )

        content = []
        for content_item_data in self.content:
            content_item: dict[str, Any]
            if isinstance(content_item_data, PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType0):
                content_item = content_item_data.to_dict()
            elif isinstance(content_item_data, PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType1):
                content_item = content_item_data.to_dict()
            elif isinstance(content_item_data, PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType2):
                content_item = content_item_data.to_dict()
            elif isinstance(content_item_data, PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType3):
                content_item = content_item_data.to_dict()
            else:
                content_item = content_item_data.to_dict()

            content.append(content_item)

        id = self.id

        trace_id = self.trace_id

        role = self.role

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "content": content,
            }
        )
        if id is not UNSET:
            field_dict["id"] = id
        if trace_id is not UNSET:
            field_dict["trace_id"] = trace_id
        if role is not UNSET:
            field_dict["role"] = role

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_1_content_item_type_0 import (
            PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType0,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_1_content_item_type_1 import (
            PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType1,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_1_content_item_type_2 import (
            PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType2,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_1_content_item_type_3 import (
            PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType3,
        )
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_1_content_item_type_4 import (
            PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType4,
        )

        d = dict(src_dict)
        content = []
        _content = d.pop("content")
        for content_item_data in _content:

            def _parse_content_item(
                data: object,
            ) -> (
                PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType0
                | PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType1
                | PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType2
                | PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType3
                | PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType4
            ):
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    content_item_type_0 = PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType0.from_dict(
                        data
                    )

                    return content_item_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    content_item_type_1 = PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType1.from_dict(
                        data
                    )

                    return content_item_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    content_item_type_2 = PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType2.from_dict(
                        data
                    )

                    return content_item_type_2
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    content_item_type_3 = PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType3.from_dict(
                        data
                    )

                    return content_item_type_3
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                content_item_type_4 = PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType4.from_dict(data)

                return content_item_type_4

            content_item = _parse_content_item(content_item_data)

            content.append(content_item)

        id = d.pop("id", UNSET)

        trace_id = d.pop("trace_id", UNSET)

        role = d.pop("role", UNSET)

        post_api_scenario_events_body_type_2_messages_item_type_1 = cls(
            content=content,
            id=id,
            trace_id=trace_id,
            role=role,
        )

        post_api_scenario_events_body_type_2_messages_item_type_1.additional_properties = d
        return post_api_scenario_events_body_type_2_messages_item_type_1

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
