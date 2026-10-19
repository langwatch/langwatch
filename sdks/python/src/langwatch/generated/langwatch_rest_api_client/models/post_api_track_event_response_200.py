from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiTrackEventResponse200")


@_attrs_define
class PostApiTrackEventResponse200:
    """
    Attributes:
        message (Literal['Event tracked']):
    """

    message: Literal["Event tracked"]

    def to_dict(self) -> dict[str, Any]:
        message = self.message

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "message": message,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        message = cast(Literal["Event tracked"], d.pop("message"))
        if message != "Event tracked":
            raise ValueError(f"message must match const 'Event tracked', got '{message}'")

        post_api_track_event_response_200 = cls(
            message=message,
        )

        return post_api_track_event_response_200
