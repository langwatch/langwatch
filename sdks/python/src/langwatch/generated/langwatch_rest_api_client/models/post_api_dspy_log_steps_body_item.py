from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_dspy_log_steps_body_item_examples_item import PostApiDspyLogStepsBodyItemExamplesItem
    from ..models.post_api_dspy_log_steps_body_item_llm_calls_item import PostApiDspyLogStepsBodyItemLlmCallsItem
    from ..models.post_api_dspy_log_steps_body_item_optimizer import PostApiDspyLogStepsBodyItemOptimizer
    from ..models.post_api_dspy_log_steps_body_item_predictors_item import PostApiDspyLogStepsBodyItemPredictorsItem
    from ..models.post_api_dspy_log_steps_body_item_timestamps import PostApiDspyLogStepsBodyItemTimestamps


T = TypeVar("T", bound="PostApiDspyLogStepsBodyItem")


@_attrs_define
class PostApiDspyLogStepsBodyItem:
    """
    Attributes:
        run_id (str):
        index (str):
        score (float):
        label (str):
        optimizer (PostApiDspyLogStepsBodyItemOptimizer):
        predictors (list[PostApiDspyLogStepsBodyItemPredictorsItem]):
        timestamps (PostApiDspyLogStepsBodyItemTimestamps):
        examples (list[PostApiDspyLogStepsBodyItemExamplesItem]):
        llm_calls (list[PostApiDspyLogStepsBodyItemLlmCallsItem]):
        workflow_version_id (None | str | Unset):
        experiment_id (None | str | Unset):
        experiment_slug (None | str | Unset):
    """

    run_id: str
    index: str
    score: float
    label: str
    optimizer: PostApiDspyLogStepsBodyItemOptimizer
    predictors: list[PostApiDspyLogStepsBodyItemPredictorsItem]
    timestamps: PostApiDspyLogStepsBodyItemTimestamps
    examples: list[PostApiDspyLogStepsBodyItemExamplesItem]
    llm_calls: list[PostApiDspyLogStepsBodyItemLlmCallsItem]
    workflow_version_id: None | str | Unset = UNSET
    experiment_id: None | str | Unset = UNSET
    experiment_slug: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        run_id = self.run_id

        index = self.index

        score = self.score

        label = self.label

        optimizer = self.optimizer.to_dict()

        predictors = []
        for predictors_item_data in self.predictors:
            predictors_item = predictors_item_data.to_dict()
            predictors.append(predictors_item)

        timestamps = self.timestamps.to_dict()

        examples = []
        for examples_item_data in self.examples:
            examples_item = examples_item_data.to_dict()
            examples.append(examples_item)

        llm_calls = []
        for llm_calls_item_data in self.llm_calls:
            llm_calls_item = llm_calls_item_data.to_dict()
            llm_calls.append(llm_calls_item)

        workflow_version_id: None | str | Unset
        if isinstance(self.workflow_version_id, Unset):
            workflow_version_id = UNSET
        else:
            workflow_version_id = self.workflow_version_id

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

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "run_id": run_id,
                "index": index,
                "score": score,
                "label": label,
                "optimizer": optimizer,
                "predictors": predictors,
                "timestamps": timestamps,
                "examples": examples,
                "llm_calls": llm_calls,
            }
        )
        if workflow_version_id is not UNSET:
            field_dict["workflow_version_id"] = workflow_version_id
        if experiment_id is not UNSET:
            field_dict["experiment_id"] = experiment_id
        if experiment_slug is not UNSET:
            field_dict["experiment_slug"] = experiment_slug

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_dspy_log_steps_body_item_examples_item import PostApiDspyLogStepsBodyItemExamplesItem
        from ..models.post_api_dspy_log_steps_body_item_llm_calls_item import PostApiDspyLogStepsBodyItemLlmCallsItem
        from ..models.post_api_dspy_log_steps_body_item_optimizer import PostApiDspyLogStepsBodyItemOptimizer
        from ..models.post_api_dspy_log_steps_body_item_predictors_item import PostApiDspyLogStepsBodyItemPredictorsItem
        from ..models.post_api_dspy_log_steps_body_item_timestamps import PostApiDspyLogStepsBodyItemTimestamps

        d = dict(src_dict)
        run_id = d.pop("run_id")

        index = d.pop("index")

        score = d.pop("score")

        label = d.pop("label")

        optimizer = PostApiDspyLogStepsBodyItemOptimizer.from_dict(d.pop("optimizer"))

        predictors = []
        _predictors = d.pop("predictors")
        for predictors_item_data in _predictors:
            predictors_item = PostApiDspyLogStepsBodyItemPredictorsItem.from_dict(predictors_item_data)

            predictors.append(predictors_item)

        timestamps = PostApiDspyLogStepsBodyItemTimestamps.from_dict(d.pop("timestamps"))

        examples = []
        _examples = d.pop("examples")
        for examples_item_data in _examples:
            examples_item = PostApiDspyLogStepsBodyItemExamplesItem.from_dict(examples_item_data)

            examples.append(examples_item)

        llm_calls = []
        _llm_calls = d.pop("llm_calls")
        for llm_calls_item_data in _llm_calls:
            llm_calls_item = PostApiDspyLogStepsBodyItemLlmCallsItem.from_dict(llm_calls_item_data)

            llm_calls.append(llm_calls_item)

        def _parse_workflow_version_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        workflow_version_id = _parse_workflow_version_id(d.pop("workflow_version_id", UNSET))

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

        post_api_dspy_log_steps_body_item = cls(
            run_id=run_id,
            index=index,
            score=score,
            label=label,
            optimizer=optimizer,
            predictors=predictors,
            timestamps=timestamps,
            examples=examples,
            llm_calls=llm_calls,
            workflow_version_id=workflow_version_id,
            experiment_id=experiment_id,
            experiment_slug=experiment_slug,
        )

        post_api_dspy_log_steps_body_item.additional_properties = d
        return post_api_dspy_log_steps_body_item

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
