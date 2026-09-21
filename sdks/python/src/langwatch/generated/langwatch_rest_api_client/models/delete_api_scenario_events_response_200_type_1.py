from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="DeleteApiScenarioEventsResponse200Type1")


@_attrs_define
class DeleteApiScenarioEventsResponse200Type1:
    """
    Attributes:
        archived (int):
        failed (int):
        scenario_run_id (str):
    """

    archived: int
    failed: int
    scenario_run_id: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        archived = self.archived

        failed = self.failed

        scenario_run_id = self.scenario_run_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "archived": archived,
                "failed": failed,
                "scenarioRunId": scenario_run_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        archived = d.pop("archived")

        failed = d.pop("failed")

        scenario_run_id = d.pop("scenarioRunId")

        delete_api_scenario_events_response_200_type_1 = cls(
            archived=archived,
            failed=failed,
            scenario_run_id=scenario_run_id,
        )

        delete_api_scenario_events_response_200_type_1.additional_properties = d
        return delete_api_scenario_events_response_200_type_1

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
