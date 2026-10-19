from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_10_file import (
        PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType10File,
    )


T = TypeVar("T", bound="PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType10")


@_attrs_define
class PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType10:
    """
    Attributes:
        type_ (Literal['file']):
        file (PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType10File):
    """

    type_: Literal["file"]
    file: PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType10File
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        file = self.file.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "file": file,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_10_file import (
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType10File,
        )

        d = dict(src_dict)
        type_ = cast(Literal["file"], d.pop("type"))
        if type_ != "file":
            raise ValueError(f"type must match const 'file', got '{type_}'")

        file = PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType10File.from_dict(d.pop("file"))

        post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_10 = cls(
            type_=type_,
            file=file,
        )

        post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_10.additional_properties = d
        return post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_10

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
