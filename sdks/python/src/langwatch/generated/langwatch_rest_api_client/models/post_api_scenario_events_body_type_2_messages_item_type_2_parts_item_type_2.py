from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_2_image_url import (
        PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType2ImageUrl,
    )


T = TypeVar("T", bound="PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType2")


@_attrs_define
class PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType2:
    """
    Attributes:
        type_ (Literal['image_url']):
        image_url (PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType2ImageUrl | Unset):
    """

    type_: Literal["image_url"]
    image_url: PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType2ImageUrl | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        image_url: dict[str, Any] | Unset = UNSET
        if not isinstance(self.image_url, Unset):
            image_url = self.image_url.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
            }
        )
        if image_url is not UNSET:
            field_dict["image_url"] = image_url

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_2_image_url import (
            PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType2ImageUrl,
        )

        d = dict(src_dict)
        type_ = cast(Literal["image_url"], d.pop("type"))
        if type_ != "image_url":
            raise ValueError(f"type must match const 'image_url', got '{type_}'")

        _image_url = d.pop("image_url", UNSET)
        image_url: PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType2ImageUrl | Unset
        if isinstance(_image_url, Unset):
            image_url = UNSET
        else:
            image_url = PostApiScenarioEventsBodyType2MessagesItemType2PartsItemType2ImageUrl.from_dict(_image_url)

        post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_2 = cls(
            type_=type_,
            image_url=image_url,
        )

        post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_2.additional_properties = d
        return post_api_scenario_events_body_type_2_messages_item_type_2_parts_item_type_2

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
