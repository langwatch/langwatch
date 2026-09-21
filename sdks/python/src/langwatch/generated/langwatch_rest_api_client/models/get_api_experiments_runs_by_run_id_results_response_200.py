from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_experiments_runs_by_run_id_results_response_200_dataset_item import (
        GetApiExperimentsRunsByRunIdResultsResponse200DatasetItem,
    )
    from ..models.get_api_experiments_runs_by_run_id_results_response_200_evaluations_item import (
        GetApiExperimentsRunsByRunIdResultsResponse200EvaluationsItem,
    )
    from ..models.get_api_experiments_runs_by_run_id_results_response_200_targets_type_0_item import (
        GetApiExperimentsRunsByRunIdResultsResponse200TargetsType0Item,
    )
    from ..models.get_api_experiments_runs_by_run_id_results_response_200_timestamps import (
        GetApiExperimentsRunsByRunIdResultsResponse200Timestamps,
    )


T = TypeVar("T", bound="GetApiExperimentsRunsByRunIdResultsResponse200")


@_attrs_define
class GetApiExperimentsRunsByRunIdResultsResponse200:
    """
    Attributes:
        experiment_id (str):
        run_id (str):
        project_id (str):
        dataset (list[GetApiExperimentsRunsByRunIdResultsResponse200DatasetItem]): One row per dataset entry, with what
            the target predicted
        evaluations (list[GetApiExperimentsRunsByRunIdResultsResponse200EvaluationsItem]): One row per evaluator per
            dataset entry
        timestamps (GetApiExperimentsRunsByRunIdResultsResponse200Timestamps):
        workflow_version_id (None | str | Unset):
        progress (float | None | Unset):
        total (float | None | Unset):
        targets (list[GetApiExperimentsRunsByRunIdResultsResponse200TargetsType0Item] | None | Unset): Resolves the
            targetId each dataset row and evaluation carries
    """

    experiment_id: str
    run_id: str
    project_id: str
    dataset: list[GetApiExperimentsRunsByRunIdResultsResponse200DatasetItem]
    evaluations: list[GetApiExperimentsRunsByRunIdResultsResponse200EvaluationsItem]
    timestamps: GetApiExperimentsRunsByRunIdResultsResponse200Timestamps
    workflow_version_id: None | str | Unset = UNSET
    progress: float | None | Unset = UNSET
    total: float | None | Unset = UNSET
    targets: list[GetApiExperimentsRunsByRunIdResultsResponse200TargetsType0Item] | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        experiment_id = self.experiment_id

        run_id = self.run_id

        project_id = self.project_id

        dataset = []
        for dataset_item_data in self.dataset:
            dataset_item = dataset_item_data.to_dict()
            dataset.append(dataset_item)

        evaluations = []
        for evaluations_item_data in self.evaluations:
            evaluations_item = evaluations_item_data.to_dict()
            evaluations.append(evaluations_item)

        timestamps = self.timestamps.to_dict()

        workflow_version_id: None | str | Unset
        if isinstance(self.workflow_version_id, Unset):
            workflow_version_id = UNSET
        else:
            workflow_version_id = self.workflow_version_id

        progress: float | None | Unset
        if isinstance(self.progress, Unset):
            progress = UNSET
        else:
            progress = self.progress

        total: float | None | Unset
        if isinstance(self.total, Unset):
            total = UNSET
        else:
            total = self.total

        targets: list[dict[str, Any]] | None | Unset
        if isinstance(self.targets, Unset):
            targets = UNSET
        elif isinstance(self.targets, list):
            targets = []
            for targets_type_0_item_data in self.targets:
                targets_type_0_item = targets_type_0_item_data.to_dict()
                targets.append(targets_type_0_item)

        else:
            targets = self.targets

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "experimentId": experiment_id,
                "runId": run_id,
                "projectId": project_id,
                "dataset": dataset,
                "evaluations": evaluations,
                "timestamps": timestamps,
            }
        )
        if workflow_version_id is not UNSET:
            field_dict["workflowVersionId"] = workflow_version_id
        if progress is not UNSET:
            field_dict["progress"] = progress
        if total is not UNSET:
            field_dict["total"] = total
        if targets is not UNSET:
            field_dict["targets"] = targets

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_experiments_runs_by_run_id_results_response_200_dataset_item import (
            GetApiExperimentsRunsByRunIdResultsResponse200DatasetItem,
        )
        from ..models.get_api_experiments_runs_by_run_id_results_response_200_evaluations_item import (
            GetApiExperimentsRunsByRunIdResultsResponse200EvaluationsItem,
        )
        from ..models.get_api_experiments_runs_by_run_id_results_response_200_targets_type_0_item import (
            GetApiExperimentsRunsByRunIdResultsResponse200TargetsType0Item,
        )
        from ..models.get_api_experiments_runs_by_run_id_results_response_200_timestamps import (
            GetApiExperimentsRunsByRunIdResultsResponse200Timestamps,
        )

        d = dict(src_dict)
        experiment_id = d.pop("experimentId")

        run_id = d.pop("runId")

        project_id = d.pop("projectId")

        dataset = []
        _dataset = d.pop("dataset")
        for dataset_item_data in _dataset:
            dataset_item = GetApiExperimentsRunsByRunIdResultsResponse200DatasetItem.from_dict(dataset_item_data)

            dataset.append(dataset_item)

        evaluations = []
        _evaluations = d.pop("evaluations")
        for evaluations_item_data in _evaluations:
            evaluations_item = GetApiExperimentsRunsByRunIdResultsResponse200EvaluationsItem.from_dict(
                evaluations_item_data
            )

            evaluations.append(evaluations_item)

        timestamps = GetApiExperimentsRunsByRunIdResultsResponse200Timestamps.from_dict(d.pop("timestamps"))

        def _parse_workflow_version_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        workflow_version_id = _parse_workflow_version_id(d.pop("workflowVersionId", UNSET))

        def _parse_progress(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        progress = _parse_progress(d.pop("progress", UNSET))

        def _parse_total(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        total = _parse_total(d.pop("total", UNSET))

        def _parse_targets(
            data: object,
        ) -> list[GetApiExperimentsRunsByRunIdResultsResponse200TargetsType0Item] | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                targets_type_0 = []
                _targets_type_0 = data
                for targets_type_0_item_data in _targets_type_0:
                    targets_type_0_item = GetApiExperimentsRunsByRunIdResultsResponse200TargetsType0Item.from_dict(
                        targets_type_0_item_data
                    )

                    targets_type_0.append(targets_type_0_item)

                return targets_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[GetApiExperimentsRunsByRunIdResultsResponse200TargetsType0Item] | None | Unset, data)

        targets = _parse_targets(d.pop("targets", UNSET))

        get_api_experiments_runs_by_run_id_results_response_200 = cls(
            experiment_id=experiment_id,
            run_id=run_id,
            project_id=project_id,
            dataset=dataset,
            evaluations=evaluations,
            timestamps=timestamps,
            workflow_version_id=workflow_version_id,
            progress=progress,
            total=total,
            targets=targets,
        )

        get_api_experiments_runs_by_run_id_results_response_200.additional_properties = d
        return get_api_experiments_runs_by_run_id_results_response_200

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
