from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PollLangyControlSessionResponse200FramesItemType0Conversation")


@_attrs_define
class PollLangyControlSessionResponse200FramesItemType0Conversation:
    """
    Attributes:
        id (str):
        title (str):
        url (str):
    """

    id: str
    title: str
    url: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        title = self.title

        url = self.url

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "title": title,
                "url": url,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        title = d.pop("title")

        url = d.pop("url")

        poll_langy_control_session_response_200_frames_item_type_0_conversation = cls(
            id=id,
            title=title,
            url=url,
        )

        poll_langy_control_session_response_200_frames_item_type_0_conversation.additional_properties = d
        return poll_langy_control_session_response_200_frames_item_type_0_conversation

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
