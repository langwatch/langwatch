from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_api_simulation_runs_by_scenario_run_id_response_200_results_type_0_criteria_item_status import (
    GetApiSimulationRunsByScenarioRunIdResponse200ResultsType0CriteriaItemStatus,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiSimulationRunsByScenarioRunIdResponse200ResultsType0CriteriaItem")


@_attrs_define
class GetApiSimulationRunsByScenarioRunIdResponse200ResultsType0CriteriaItem:
    """
    Attributes:
        criterion (str):
        status (GetApiSimulationRunsByScenarioRunIdResponse200ResultsType0CriteriaItemStatus):
        reasoning (str):  Default: ''.
        requirement (str | Unset):
    """

    criterion: str
    status: GetApiSimulationRunsByScenarioRunIdResponse200ResultsType0CriteriaItemStatus
    reasoning: str = ""
    requirement: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        criterion = self.criterion

        status = self.status.value

        reasoning = self.reasoning

        requirement = self.requirement

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "criterion": criterion,
                "status": status,
                "reasoning": reasoning,
            }
        )
        if requirement is not UNSET:
            field_dict["requirement"] = requirement

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        criterion = d.pop("criterion")

        status = GetApiSimulationRunsByScenarioRunIdResponse200ResultsType0CriteriaItemStatus(d.pop("status"))

        reasoning = d.pop("reasoning")

        requirement = d.pop("requirement", UNSET)

        get_api_simulation_runs_by_scenario_run_id_response_200_results_type_0_criteria_item = cls(
            criterion=criterion,
            status=status,
            reasoning=reasoning,
            requirement=requirement,
        )

        return get_api_simulation_runs_by_scenario_run_id_response_200_results_type_0_criteria_item
