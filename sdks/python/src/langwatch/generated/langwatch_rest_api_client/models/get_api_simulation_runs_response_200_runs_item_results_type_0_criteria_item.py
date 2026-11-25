from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_api_simulation_runs_response_200_runs_item_results_type_0_criteria_item_status import (
    GetApiSimulationRunsResponse200RunsItemResultsType0CriteriaItemStatus,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiSimulationRunsResponse200RunsItemResultsType0CriteriaItem")


@_attrs_define
class GetApiSimulationRunsResponse200RunsItemResultsType0CriteriaItem:
    """
    Attributes:
        criterion (str):
        status (GetApiSimulationRunsResponse200RunsItemResultsType0CriteriaItemStatus):
        reasoning (str):  Default: ''.
        requirement (str | Unset):
    """

    criterion: str
    status: GetApiSimulationRunsResponse200RunsItemResultsType0CriteriaItemStatus
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

        status = GetApiSimulationRunsResponse200RunsItemResultsType0CriteriaItemStatus(d.pop("status"))

        reasoning = d.pop("reasoning")

        requirement = d.pop("requirement", UNSET)

        get_api_simulation_runs_response_200_runs_item_results_type_0_criteria_item = cls(
            criterion=criterion,
            status=status,
            reasoning=reasoning,
            requirement=requirement,
        )

        return get_api_simulation_runs_response_200_runs_item_results_type_0_criteria_item
