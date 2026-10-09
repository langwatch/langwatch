from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_dataset_evaluate_body_data_type_0 import PostApiDatasetEvaluateBodyDataType0
    from ..models.post_api_dataset_evaluate_body_settings_type_0 import PostApiDatasetEvaluateBodySettingsType0


T = TypeVar("T", bound="PostApiDatasetEvaluateBody")


@_attrs_define
class PostApiDatasetEvaluateBody:
    """
    Attributes:
        evaluation (str): Which evaluator to run, addressed the same way the evaluate endpoints address it
        dataset_slug (str): The saved dataset to evaluate
        experiment_slug (str | Unset): Groups the results under an experiment. Omit it and a batch id is generated
            instead.
        batch_id (str | Unset): Older name for experimentSlug, used when that is absent
        data (None | PostApiDatasetEvaluateBodyDataType0 | Unset): Extra fields merged into every row before evaluating
        settings (None | PostApiDatasetEvaluateBodySettingsType0 | Unset): Per-call overrides of the evaluator's
            settings
    """

    evaluation: str
    dataset_slug: str
    experiment_slug: str | Unset = UNSET
    batch_id: str | Unset = UNSET
    data: None | PostApiDatasetEvaluateBodyDataType0 | Unset = UNSET
    settings: None | PostApiDatasetEvaluateBodySettingsType0 | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_dataset_evaluate_body_data_type_0 import PostApiDatasetEvaluateBodyDataType0
        from ..models.post_api_dataset_evaluate_body_settings_type_0 import PostApiDatasetEvaluateBodySettingsType0

        evaluation = self.evaluation

        dataset_slug = self.dataset_slug

        experiment_slug = self.experiment_slug

        batch_id = self.batch_id

        data: dict[str, Any] | None | Unset
        if isinstance(self.data, Unset):
            data = UNSET
        elif isinstance(self.data, PostApiDatasetEvaluateBodyDataType0):
            data = self.data.to_dict()
        else:
            data = self.data

        settings: dict[str, Any] | None | Unset
        if isinstance(self.settings, Unset):
            settings = UNSET
        elif isinstance(self.settings, PostApiDatasetEvaluateBodySettingsType0):
            settings = self.settings.to_dict()
        else:
            settings = self.settings

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "evaluation": evaluation,
                "datasetSlug": dataset_slug,
            }
        )
        if experiment_slug is not UNSET:
            field_dict["experimentSlug"] = experiment_slug
        if batch_id is not UNSET:
            field_dict["batchId"] = batch_id
        if data is not UNSET:
            field_dict["data"] = data
        if settings is not UNSET:
            field_dict["settings"] = settings

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_dataset_evaluate_body_data_type_0 import PostApiDatasetEvaluateBodyDataType0
        from ..models.post_api_dataset_evaluate_body_settings_type_0 import PostApiDatasetEvaluateBodySettingsType0

        d = dict(src_dict)
        evaluation = d.pop("evaluation")

        dataset_slug = d.pop("datasetSlug")

        experiment_slug = d.pop("experimentSlug", UNSET)

        batch_id = d.pop("batchId", UNSET)

        def _parse_data(data: object) -> None | PostApiDatasetEvaluateBodyDataType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                data_type_0 = PostApiDatasetEvaluateBodyDataType0.from_dict(data)

                return data_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PostApiDatasetEvaluateBodyDataType0 | Unset, data)

        data = _parse_data(d.pop("data", UNSET))

        def _parse_settings(data: object) -> None | PostApiDatasetEvaluateBodySettingsType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                settings_type_0 = PostApiDatasetEvaluateBodySettingsType0.from_dict(data)

                return settings_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PostApiDatasetEvaluateBodySettingsType0 | Unset, data)

        settings = _parse_settings(d.pop("settings", UNSET))

        post_api_dataset_evaluate_body = cls(
            evaluation=evaluation,
            dataset_slug=dataset_slug,
            experiment_slug=experiment_slug,
            batch_id=batch_id,
            data=data,
            settings=settings,
        )

        return post_api_dataset_evaluate_body
