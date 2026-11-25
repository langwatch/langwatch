from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_experiments_runs_response_200_runs_item_summary_evaluations import (
        GetApiExperimentsRunsResponse200RunsItemSummaryEvaluations,
    )


T = TypeVar("T", bound="GetApiExperimentsRunsResponse200RunsItemSummary")


@_attrs_define
class GetApiExperimentsRunsResponse200RunsItemSummary:
    """
    Attributes:
        evaluations (GetApiExperimentsRunsResponse200RunsItemSummaryEvaluations):
        dataset_cost (float | Unset):
        evaluations_cost (float | Unset):
        dataset_average_cost (float | Unset):
        dataset_average_duration (float | Unset):
        evaluations_average_cost (float | Unset):
        evaluations_average_duration (float | Unset):
    """

    evaluations: GetApiExperimentsRunsResponse200RunsItemSummaryEvaluations
    dataset_cost: float | Unset = UNSET
    evaluations_cost: float | Unset = UNSET
    dataset_average_cost: float | Unset = UNSET
    dataset_average_duration: float | Unset = UNSET
    evaluations_average_cost: float | Unset = UNSET
    evaluations_average_duration: float | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        evaluations = self.evaluations.to_dict()

        dataset_cost = self.dataset_cost

        evaluations_cost = self.evaluations_cost

        dataset_average_cost = self.dataset_average_cost

        dataset_average_duration = self.dataset_average_duration

        evaluations_average_cost = self.evaluations_average_cost

        evaluations_average_duration = self.evaluations_average_duration

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "evaluations": evaluations,
            }
        )
        if dataset_cost is not UNSET:
            field_dict["datasetCost"] = dataset_cost
        if evaluations_cost is not UNSET:
            field_dict["evaluationsCost"] = evaluations_cost
        if dataset_average_cost is not UNSET:
            field_dict["datasetAverageCost"] = dataset_average_cost
        if dataset_average_duration is not UNSET:
            field_dict["datasetAverageDuration"] = dataset_average_duration
        if evaluations_average_cost is not UNSET:
            field_dict["evaluationsAverageCost"] = evaluations_average_cost
        if evaluations_average_duration is not UNSET:
            field_dict["evaluationsAverageDuration"] = evaluations_average_duration

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_experiments_runs_response_200_runs_item_summary_evaluations import (
            GetApiExperimentsRunsResponse200RunsItemSummaryEvaluations,
        )

        d = dict(src_dict)
        evaluations = GetApiExperimentsRunsResponse200RunsItemSummaryEvaluations.from_dict(d.pop("evaluations"))

        dataset_cost = d.pop("datasetCost", UNSET)

        evaluations_cost = d.pop("evaluationsCost", UNSET)

        dataset_average_cost = d.pop("datasetAverageCost", UNSET)

        dataset_average_duration = d.pop("datasetAverageDuration", UNSET)

        evaluations_average_cost = d.pop("evaluationsAverageCost", UNSET)

        evaluations_average_duration = d.pop("evaluationsAverageDuration", UNSET)

        get_api_experiments_runs_response_200_runs_item_summary = cls(
            evaluations=evaluations,
            dataset_cost=dataset_cost,
            evaluations_cost=evaluations_cost,
            dataset_average_cost=dataset_average_cost,
            dataset_average_duration=dataset_average_duration,
            evaluations_average_cost=evaluations_average_cost,
            evaluations_average_duration=evaluations_average_duration,
        )

        return get_api_experiments_runs_response_200_runs_item_summary
