from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_traces_facets_response_200_type_0_facets_item_type_0_top_values_item_aggregates_label_values_item import (
        GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemAggregatesLabelValuesItem,
    )


T = TypeVar("T", bound="GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemAggregates")


@_attrs_define
class GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemAggregates:
    """
    Attributes:
        passed_count (float):
        failed_count (float):
        errored_count (float):
        score_min (float | None):
        score_max (float | None):
        has_score (bool):
        distinct_scores (float):
        has_label (bool):
        label_values (list[GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemAggregatesLabelValuesItem] |
            Unset):
    """

    passed_count: float
    failed_count: float
    errored_count: float
    score_min: float | None
    score_max: float | None
    has_score: bool
    distinct_scores: float
    has_label: bool
    label_values: (
        list[GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemAggregatesLabelValuesItem] | Unset
    ) = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        passed_count = self.passed_count

        failed_count = self.failed_count

        errored_count = self.errored_count

        score_min: float | None
        score_min = self.score_min

        score_max: float | None
        score_max = self.score_max

        has_score = self.has_score

        distinct_scores = self.distinct_scores

        has_label = self.has_label

        label_values: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.label_values, Unset):
            label_values = []
            for label_values_item_data in self.label_values:
                label_values_item = label_values_item_data.to_dict()
                label_values.append(label_values_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "passedCount": passed_count,
                "failedCount": failed_count,
                "erroredCount": errored_count,
                "scoreMin": score_min,
                "scoreMax": score_max,
                "hasScore": has_score,
                "distinctScores": distinct_scores,
                "hasLabel": has_label,
            }
        )
        if label_values is not UNSET:
            field_dict["labelValues"] = label_values

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_traces_facets_response_200_type_0_facets_item_type_0_top_values_item_aggregates_label_values_item import (
            GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemAggregatesLabelValuesItem,
        )

        d = dict(src_dict)
        passed_count = d.pop("passedCount")

        failed_count = d.pop("failedCount")

        errored_count = d.pop("erroredCount")

        def _parse_score_min(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        score_min = _parse_score_min(d.pop("scoreMin"))

        def _parse_score_max(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        score_max = _parse_score_max(d.pop("scoreMax"))

        has_score = d.pop("hasScore")

        distinct_scores = d.pop("distinctScores")

        has_label = d.pop("hasLabel")

        _label_values = d.pop("labelValues", UNSET)
        label_values: (
            list[GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemAggregatesLabelValuesItem] | Unset
        ) = UNSET
        if _label_values is not UNSET:
            label_values = []
            for label_values_item_data in _label_values:
                label_values_item = (
                    GetApiTracesFacetsResponse200Type0FacetsItemType0TopValuesItemAggregatesLabelValuesItem.from_dict(
                        label_values_item_data
                    )
                )

                label_values.append(label_values_item)

        get_api_traces_facets_response_200_type_0_facets_item_type_0_top_values_item_aggregates = cls(
            passed_count=passed_count,
            failed_count=failed_count,
            errored_count=errored_count,
            score_min=score_min,
            score_max=score_max,
            has_score=has_score,
            distinct_scores=distinct_scores,
            has_label=has_label,
            label_values=label_values,
        )

        get_api_traces_facets_response_200_type_0_facets_item_type_0_top_values_item_aggregates.additional_properties = d
        return get_api_traces_facets_response_200_type_0_facets_item_type_0_top_values_item_aggregates

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
