from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiSimulationRunsByScenarioRunIdResponse200MessagesItem")


@_attrs_define
class GetApiSimulationRunsByScenarioRunIdResponse200MessagesItem:
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

        get_api_simulation_runs_by_scenario_run_id_response_200_messages_item = cls(
            role=role,
            content=content,
        )

        return get_api_simulation_runs_by_scenario_run_id_response_200_messages_item
