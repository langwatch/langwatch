from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_evaluations_batch_log_results_body_dataset_item_entry import (
        PostApiEvaluationsBatchLogResultsBodyDatasetItemEntry,
    )
    from ..models.post_api_evaluations_batch_log_results_body_dataset_item_predicted_type_0 import (
        PostApiEvaluationsBatchLogResultsBodyDatasetItemPredictedType0,
    )


T = TypeVar("T", bound="PostApiEvaluationsBatchLogResultsBodyDatasetItem")


@_attrs_define
class PostApiEvaluationsBatchLogResultsBodyDatasetItem:
    """
    Attributes:
        index (float):
        entry (PostApiEvaluationsBatchLogResultsBodyDatasetItemEntry):
        target_id (None | str | Unset):
        predicted (None | PostApiEvaluationsBatchLogResultsBodyDatasetItemPredictedType0 | Unset):
        cost (float | None | Unset):
        duration (float | None | Unset):
        error (None | str | Unset):
        trace_id (None | str | Unset):
    """

    index: float
    entry: PostApiEvaluationsBatchLogResultsBodyDatasetItemEntry
    target_id: None | str | Unset = UNSET
    predicted: None | PostApiEvaluationsBatchLogResultsBodyDatasetItemPredictedType0 | Unset = UNSET
    cost: float | None | Unset = UNSET
    duration: float | None | Unset = UNSET
    error: None | str | Unset = UNSET
    trace_id: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_evaluations_batch_log_results_body_dataset_item_predicted_type_0 import (
            PostApiEvaluationsBatchLogResultsBodyDatasetItemPredictedType0,
        )

        index = self.index

        entry = self.entry.to_dict()

        target_id: None | str | Unset
        if isinstance(self.target_id, Unset):
            target_id = UNSET
        else:
            target_id = self.target_id

        predicted: dict[str, Any] | None | Unset
        if isinstance(self.predicted, Unset):
            predicted = UNSET
        elif isinstance(self.predicted, PostApiEvaluationsBatchLogResultsBodyDatasetItemPredictedType0):
            predicted = self.predicted.to_dict()
        else:
            predicted = self.predicted

        cost: float | None | Unset
        if isinstance(self.cost, Unset):
            cost = UNSET
        else:
            cost = self.cost

        duration: float | None | Unset
        if isinstance(self.duration, Unset):
            duration = UNSET
        else:
            duration = self.duration

        error: None | str | Unset
        if isinstance(self.error, Unset):
            error = UNSET
        else:
            error = self.error

        trace_id: None | str | Unset
        if isinstance(self.trace_id, Unset):
            trace_id = UNSET
        else:
            trace_id = self.trace_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "index": index,
                "entry": entry,
            }
        )
        if target_id is not UNSET:
            field_dict["target_id"] = target_id
        if predicted is not UNSET:
            field_dict["predicted"] = predicted
        if cost is not UNSET:
            field_dict["cost"] = cost
        if duration is not UNSET:
            field_dict["duration"] = duration
        if error is not UNSET:
            field_dict["error"] = error
        if trace_id is not UNSET:
            field_dict["trace_id"] = trace_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_evaluations_batch_log_results_body_dataset_item_entry import (
            PostApiEvaluationsBatchLogResultsBodyDatasetItemEntry,
        )
        from ..models.post_api_evaluations_batch_log_results_body_dataset_item_predicted_type_0 import (
            PostApiEvaluationsBatchLogResultsBodyDatasetItemPredictedType0,
        )

        d = dict(src_dict)
        index = d.pop("index")

        entry = PostApiEvaluationsBatchLogResultsBodyDatasetItemEntry.from_dict(d.pop("entry"))

        def _parse_target_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        target_id = _parse_target_id(d.pop("target_id", UNSET))

        def _parse_predicted(
            data: object,
        ) -> None | PostApiEvaluationsBatchLogResultsBodyDatasetItemPredictedType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                predicted_type_0 = PostApiEvaluationsBatchLogResultsBodyDatasetItemPredictedType0.from_dict(data)

                return predicted_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PostApiEvaluationsBatchLogResultsBodyDatasetItemPredictedType0 | Unset, data)

        predicted = _parse_predicted(d.pop("predicted", UNSET))

        def _parse_cost(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        cost = _parse_cost(d.pop("cost", UNSET))

        def _parse_duration(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        duration = _parse_duration(d.pop("duration", UNSET))

        def _parse_error(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        error = _parse_error(d.pop("error", UNSET))

        def _parse_trace_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        trace_id = _parse_trace_id(d.pop("trace_id", UNSET))

        post_api_evaluations_batch_log_results_body_dataset_item = cls(
            index=index,
            entry=entry,
            target_id=target_id,
            predicted=predicted,
            cost=cost,
            duration=duration,
            error=error,
            trace_id=trace_id,
        )

        post_api_evaluations_batch_log_results_body_dataset_item.additional_properties = d
        return post_api_evaluations_batch_log_results_body_dataset_item

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
