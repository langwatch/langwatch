from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiDspyLogStepsBodyItemTimestamps")


@_attrs_define
class PostApiDspyLogStepsBodyItemTimestamps:
    """
    Attributes:
        created_at (float):
    """

    created_at: float

    def to_dict(self) -> dict[str, Any]:
        created_at = self.created_at

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "created_at": created_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        created_at = d.pop("created_at")

        post_api_dspy_log_steps_body_item_timestamps = cls(
            created_at=created_at,
        )

        return post_api_dspy_log_steps_body_item_timestamps
