from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

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

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        title = self.title

        url = self.url

        field_dict: dict[str, Any] = {}

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

        return poll_langy_control_session_response_200_frames_item_type_0_conversation
