from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="RegisterLangyControlSessionResponse200FrameType0Conversation")


@_attrs_define
class RegisterLangyControlSessionResponse200FrameType0Conversation:
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

        register_langy_control_session_response_200_frame_type_0_conversation = cls(
            id=id,
            title=title,
            url=url,
        )

        return register_langy_control_session_response_200_frame_type_0_conversation
