from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="DeleteApiScenarioEventsResponse200")


@_attrs_define
class DeleteApiScenarioEventsResponse200:
    """
    Attributes:
        archived (int):
        failed (int):
        scenario_set_id (str | Unset):
        has_more (bool | Unset):
        scenario_run_id (str | Unset):
    """

    archived: int
    failed: int
    scenario_set_id: str | Unset = UNSET
    has_more: bool | Unset = UNSET
    scenario_run_id: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        archived = self.archived

        failed = self.failed

        scenario_set_id = self.scenario_set_id

        has_more = self.has_more

        scenario_run_id = self.scenario_run_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "archived": archived,
                "failed": failed,
            }
        )
        if scenario_set_id is not UNSET:
            field_dict["scenarioSetId"] = scenario_set_id
        if has_more is not UNSET:
            field_dict["hasMore"] = has_more
        if scenario_run_id is not UNSET:
            field_dict["scenarioRunId"] = scenario_run_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        archived = d.pop("archived")

        failed = d.pop("failed")

        scenario_set_id = d.pop("scenarioSetId", UNSET)

        has_more = d.pop("hasMore", UNSET)

        scenario_run_id = d.pop("scenarioRunId", UNSET)

        delete_api_scenario_events_response_200 = cls(
            archived=archived,
            failed=failed,
            scenario_set_id=scenario_set_id,
            has_more=has_more,
            scenario_run_id=scenario_run_id,
        )

        return delete_api_scenario_events_response_200
