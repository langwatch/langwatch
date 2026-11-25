from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType2")


@_attrs_define
class PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType2:
    """
    Attributes:
        type_ (Literal['tool_result']):
        tool_use_id (str):
        content (list[Any] | str | Unset):
        is_error (bool | Unset):
    """

    type_: Literal["tool_result"]
    tool_use_id: str
    content: list[Any] | str | Unset = UNSET
    is_error: bool | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        tool_use_id = self.tool_use_id

        content: list[Any] | str | Unset
        if isinstance(self.content, Unset):
            content = UNSET
        elif isinstance(self.content, list):
            content = self.content

        else:
            content = self.content

        is_error = self.is_error

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "tool_use_id": tool_use_id,
            }
        )
        if content is not UNSET:
            field_dict["content"] = content
        if is_error is not UNSET:
            field_dict["is_error"] = is_error

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = cast(Literal["tool_result"], d.pop("type"))
        if type_ != "tool_result":
            raise ValueError(f"type must match const 'tool_result', got '{type_}'")

        tool_use_id = d.pop("tool_use_id")

        def _parse_content(data: object) -> list[Any] | str | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                content_type_1 = cast(list[Any], data)

                return content_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[Any] | str | Unset, data)

        content = _parse_content(d.pop("content", UNSET))

        is_error = d.pop("is_error", UNSET)

        post_api_scenario_events_body_type_2_messages_item_type_1_content_item_type_2 = cls(
            type_=type_,
            tool_use_id=tool_use_id,
            content=content,
            is_error=is_error,
        )

        post_api_scenario_events_body_type_2_messages_item_type_1_content_item_type_2.additional_properties = d
        return post_api_scenario_events_body_type_2_messages_item_type_1_content_item_type_2

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
