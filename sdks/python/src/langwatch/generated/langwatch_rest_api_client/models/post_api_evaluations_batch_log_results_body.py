from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_evaluations_batch_log_results_body_dataset_item import (
        PostApiEvaluationsBatchLogResultsBodyDatasetItem,
    )
    from ..models.post_api_evaluations_batch_log_results_body_evaluations_item import (
        PostApiEvaluationsBatchLogResultsBodyEvaluationsItem,
    )
    from ..models.post_api_evaluations_batch_log_results_body_targets_type_0_item import (
        PostApiEvaluationsBatchLogResultsBodyTargetsType0Item,
    )
    from ..models.post_api_evaluations_batch_log_results_body_timestamps import (
        PostApiEvaluationsBatchLogResultsBodyTimestamps,
    )


T = TypeVar("T", bound="PostApiEvaluationsBatchLogResultsBody")


@_attrs_define
class PostApiEvaluationsBatchLogResultsBody:
    """
    Attributes:
        run_id (str):
        workflow_version_id (None | str | Unset):
        progress (float | None | Unset):
        total (float | None | Unset):
        dataset (list[PostApiEvaluationsBatchLogResultsBodyDatasetItem] | Unset):
        evaluations (list[PostApiEvaluationsBatchLogResultsBodyEvaluationsItem] | Unset):
        experiment_id (None | str | Unset):
        experiment_slug (None | str | Unset):
        workflow_id (None | str | Unset):
        name (None | str | Unset):
        targets (list[PostApiEvaluationsBatchLogResultsBodyTargetsType0Item] | None | Unset):
        timestamps (PostApiEvaluationsBatchLogResultsBodyTimestamps | Unset):
    """

    run_id: str
    workflow_version_id: None | str | Unset = UNSET
    progress: float | None | Unset = UNSET
    total: float | None | Unset = UNSET
    dataset: list[PostApiEvaluationsBatchLogResultsBodyDatasetItem] | Unset = UNSET
    evaluations: list[PostApiEvaluationsBatchLogResultsBodyEvaluationsItem] | Unset = UNSET
    experiment_id: None | str | Unset = UNSET
    experiment_slug: None | str | Unset = UNSET
    workflow_id: None | str | Unset = UNSET
    name: None | str | Unset = UNSET
    targets: list[PostApiEvaluationsBatchLogResultsBodyTargetsType0Item] | None | Unset = UNSET
    timestamps: PostApiEvaluationsBatchLogResultsBodyTimestamps | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        run_id = self.run_id

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

        dataset: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.dataset, Unset):
            dataset = []
            for dataset_item_data in self.dataset:
                dataset_item = dataset_item_data.to_dict()
                dataset.append(dataset_item)

        evaluations: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.evaluations, Unset):
            evaluations = []
            for evaluations_item_data in self.evaluations:
                evaluations_item = evaluations_item_data.to_dict()
                evaluations.append(evaluations_item)

        experiment_id: None | str | Unset
        if isinstance(self.experiment_id, Unset):
            experiment_id = UNSET
        else:
            experiment_id = self.experiment_id

        experiment_slug: None | str | Unset
        if isinstance(self.experiment_slug, Unset):
            experiment_slug = UNSET
        else:
            experiment_slug = self.experiment_slug

        workflow_id: None | str | Unset
        if isinstance(self.workflow_id, Unset):
            workflow_id = UNSET
        else:
            workflow_id = self.workflow_id

        name: None | str | Unset
        if isinstance(self.name, Unset):
            name = UNSET
        else:
            name = self.name

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

        timestamps: dict[str, Any] | Unset = UNSET
        if not isinstance(self.timestamps, Unset):
            timestamps = self.timestamps.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "run_id": run_id,
            }
        )
        if workflow_version_id is not UNSET:
            field_dict["workflow_version_id"] = workflow_version_id
        if progress is not UNSET:
            field_dict["progress"] = progress
        if total is not UNSET:
            field_dict["total"] = total
        if dataset is not UNSET:
            field_dict["dataset"] = dataset
        if evaluations is not UNSET:
            field_dict["evaluations"] = evaluations
        if experiment_id is not UNSET:
            field_dict["experiment_id"] = experiment_id
        if experiment_slug is not UNSET:
            field_dict["experiment_slug"] = experiment_slug
        if workflow_id is not UNSET:
            field_dict["workflow_id"] = workflow_id
        if name is not UNSET:
            field_dict["name"] = name
        if targets is not UNSET:
            field_dict["targets"] = targets
        if timestamps is not UNSET:
            field_dict["timestamps"] = timestamps

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_evaluations_batch_log_results_body_dataset_item import (
            PostApiEvaluationsBatchLogResultsBodyDatasetItem,
        )
        from ..models.post_api_evaluations_batch_log_results_body_evaluations_item import (
            PostApiEvaluationsBatchLogResultsBodyEvaluationsItem,
        )
        from ..models.post_api_evaluations_batch_log_results_body_targets_type_0_item import (
            PostApiEvaluationsBatchLogResultsBodyTargetsType0Item,
        )
        from ..models.post_api_evaluations_batch_log_results_body_timestamps import (
            PostApiEvaluationsBatchLogResultsBodyTimestamps,
        )

        d = dict(src_dict)
        run_id = d.pop("run_id")

        def _parse_workflow_version_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        workflow_version_id = _parse_workflow_version_id(d.pop("workflow_version_id", UNSET))

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

        _dataset = d.pop("dataset", UNSET)
        dataset: list[PostApiEvaluationsBatchLogResultsBodyDatasetItem] | Unset = UNSET
        if _dataset is not UNSET:
            dataset = []
            for dataset_item_data in _dataset:
                dataset_item = PostApiEvaluationsBatchLogResultsBodyDatasetItem.from_dict(dataset_item_data)

                dataset.append(dataset_item)

        _evaluations = d.pop("evaluations", UNSET)
        evaluations: list[PostApiEvaluationsBatchLogResultsBodyEvaluationsItem] | Unset = UNSET
        if _evaluations is not UNSET:
            evaluations = []
            for evaluations_item_data in _evaluations:
                evaluations_item = PostApiEvaluationsBatchLogResultsBodyEvaluationsItem.from_dict(evaluations_item_data)

                evaluations.append(evaluations_item)

        def _parse_experiment_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        experiment_id = _parse_experiment_id(d.pop("experiment_id", UNSET))

        def _parse_experiment_slug(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        experiment_slug = _parse_experiment_slug(d.pop("experiment_slug", UNSET))

        def _parse_workflow_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        workflow_id = _parse_workflow_id(d.pop("workflow_id", UNSET))

        def _parse_name(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        name = _parse_name(d.pop("name", UNSET))

        def _parse_targets(data: object) -> list[PostApiEvaluationsBatchLogResultsBodyTargetsType0Item] | None | Unset:
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
                    targets_type_0_item = PostApiEvaluationsBatchLogResultsBodyTargetsType0Item.from_dict(
                        targets_type_0_item_data
                    )

                    targets_type_0.append(targets_type_0_item)

                return targets_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[PostApiEvaluationsBatchLogResultsBodyTargetsType0Item] | None | Unset, data)

        targets = _parse_targets(d.pop("targets", UNSET))

        _timestamps = d.pop("timestamps", UNSET)
        timestamps: PostApiEvaluationsBatchLogResultsBodyTimestamps | Unset
        if isinstance(_timestamps, Unset):
            timestamps = UNSET
        else:
            timestamps = PostApiEvaluationsBatchLogResultsBodyTimestamps.from_dict(_timestamps)

        post_api_evaluations_batch_log_results_body = cls(
            run_id=run_id,
            workflow_version_id=workflow_version_id,
            progress=progress,
            total=total,
            dataset=dataset,
            evaluations=evaluations,
            experiment_id=experiment_id,
            experiment_slug=experiment_slug,
            workflow_id=workflow_id,
            name=name,
            targets=targets,
            timestamps=timestamps,
        )

        post_api_evaluations_batch_log_results_body.additional_properties = d
        return post_api_evaluations_batch_log_results_body

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
