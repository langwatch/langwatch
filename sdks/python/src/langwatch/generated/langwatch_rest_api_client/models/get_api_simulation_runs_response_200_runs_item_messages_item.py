from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiSimulationRunsResponse200RunsItemMessagesItem")


@_attrs_define
class GetApiSimulationRunsResponse200RunsItemMessagesItem:
    """
    Attributes:
        role (str):
        content (str):
    """

    role: str
    content: str

    def to_dict(self) -> dict[str, Any]:
        role = self.role

        content = self.content

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "role": role,
                "content": content,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        role = d.pop("role")

        content = d.pop("content")

        get_api_simulation_runs_response_200_runs_item_messages_item = cls(
            role=role,
            content=content,
        )

        return get_api_simulation_runs_response_200_runs_item_messages_item
