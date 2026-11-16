from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="DeleteApiScenarioEventsResponse400")


@_attrs_define
class DeleteApiScenarioEventsResponse400:
    """
    Attributes:
        error (str):
    """

    error: str

    def to_dict(self) -> dict[str, Any]:
        error = self.error

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "error": error,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        error = d.pop("error")

        delete_api_scenario_events_response_400 = cls(
            error=error,
        )

        return delete_api_scenario_events_response_400
