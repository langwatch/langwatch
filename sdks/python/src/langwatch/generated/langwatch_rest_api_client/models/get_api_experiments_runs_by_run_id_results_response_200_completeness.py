from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_experiments_runs_by_run_id_results_response_200_completeness_dataset import (
        GetApiExperimentsRunsByRunIdResultsResponse200CompletenessDataset,
    )
    from ..models.get_api_experiments_runs_by_run_id_results_response_200_completeness_evaluations import (
        GetApiExperimentsRunsByRunIdResultsResponse200CompletenessEvaluations,
    )


T = TypeVar("T", bound="GetApiExperimentsRunsByRunIdResultsResponse200Completeness")


@_attrs_define
class GetApiExperimentsRunsByRunIdResultsResponse200Completeness:
    """What is stored against what the run reported. Results are stored after they are reported, so a read can hold part of
    a run: `complete` is false until the run has ended and every reported row and evaluation is stored. `expected` is
    null when the run reported no counts

        Attributes:
            complete (bool):
            dataset (GetApiExperimentsRunsByRunIdResultsResponse200CompletenessDataset):
            evaluations (GetApiExperimentsRunsByRunIdResultsResponse200CompletenessEvaluations):
    """

    complete: bool
    dataset: GetApiExperimentsRunsByRunIdResultsResponse200CompletenessDataset
    evaluations: GetApiExperimentsRunsByRunIdResultsResponse200CompletenessEvaluations

    def to_dict(self) -> dict[str, Any]:
        complete = self.complete

        dataset = self.dataset.to_dict()

        evaluations = self.evaluations.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "complete": complete,
                "dataset": dataset,
                "evaluations": evaluations,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_experiments_runs_by_run_id_results_response_200_completeness_dataset import (
            GetApiExperimentsRunsByRunIdResultsResponse200CompletenessDataset,
        )
        from ..models.get_api_experiments_runs_by_run_id_results_response_200_completeness_evaluations import (
            GetApiExperimentsRunsByRunIdResultsResponse200CompletenessEvaluations,
        )

        d = dict(src_dict)
        complete = d.pop("complete")

        dataset = GetApiExperimentsRunsByRunIdResultsResponse200CompletenessDataset.from_dict(d.pop("dataset"))

        evaluations = GetApiExperimentsRunsByRunIdResultsResponse200CompletenessEvaluations.from_dict(
            d.pop("evaluations")
        )

        get_api_experiments_runs_by_run_id_results_response_200_completeness = cls(
            complete=complete,
            dataset=dataset,
            evaluations=evaluations,
        )

        return get_api_experiments_runs_by_run_id_results_response_200_completeness
