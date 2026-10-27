from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiScenarioEventsBodyType2MessagesItemType3ContentItemType1InputAudio")


@_attrs_define
class PostApiScenarioEventsBodyType2MessagesItemType3ContentItemType1InputAudio:
    """
    Attributes:
        data (str | Unset):
        format_ (str | Unset):
        mime_type (str | Unset):
        url (str | Unset):
        id (str | Unset):
    """

    data: str | Unset = UNSET
    format_: str | Unset = UNSET
    mime_type: str | Unset = UNSET
    url: str | Unset = UNSET
    id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        data = self.data

        format_ = self.format_

        mime_type = self.mime_type

        url = self.url

        id = self.id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if data is not UNSET:
            field_dict["data"] = data
        if format_ is not UNSET:
            field_dict["format"] = format_
        if mime_type is not UNSET:
            field_dict["mimeType"] = mime_type
        if url is not UNSET:
            field_dict["url"] = url
        if id is not UNSET:
            field_dict["id"] = id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        data = d.pop("data", UNSET)

        format_ = d.pop("format", UNSET)

        mime_type = d.pop("mimeType", UNSET)

        url = d.pop("url", UNSET)

        id = d.pop("id", UNSET)

        post_api_scenario_events_body_type_2_messages_item_type_3_content_item_type_1_input_audio = cls(
            data=data,
            format_=format_,
            mime_type=mime_type,
            url=url,
            id=id,
        )

        post_api_scenario_events_body_type_2_messages_item_type_3_content_item_type_1_input_audio.additional_properties = d
        return post_api_scenario_events_body_type_2_messages_item_type_3_content_item_type_1_input_audio

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
