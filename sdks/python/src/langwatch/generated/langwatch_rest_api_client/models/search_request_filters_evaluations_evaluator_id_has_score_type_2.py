from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.search_request_filters_evaluations_evaluator_id_has_score_type_2_additional_property import (
        SearchRequestFiltersEvaluationsEvaluatorIdHasScoreType2AdditionalProperty,
    )


T = TypeVar("T", bound="SearchRequestFiltersEvaluationsEvaluatorIdHasScoreType2")


@_attrs_define
class SearchRequestFiltersEvaluationsEvaluatorIdHasScoreType2:
    """ """

    additional_properties: dict[str, SearchRequestFiltersEvaluationsEvaluatorIdHasScoreType2AdditionalProperty] = (
        _attrs_field(init=False, factory=dict)
    )

    def to_dict(self) -> dict[str, Any]:

        field_dict: dict[str, Any] = {}
        for prop_name, prop in self.additional_properties.items():
            field_dict[prop_name] = prop.to_dict()

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.search_request_filters_evaluations_evaluator_id_has_score_type_2_additional_property import (
            SearchRequestFiltersEvaluationsEvaluatorIdHasScoreType2AdditionalProperty,
        )

        d = dict(src_dict)
        search_request_filters_evaluations_evaluator_id_has_score_type_2 = cls()

        additional_properties = {}
        for prop_name, prop_dict in d.items():
            additional_property = SearchRequestFiltersEvaluationsEvaluatorIdHasScoreType2AdditionalProperty.from_dict(
                prop_dict
            )

            additional_properties[prop_name] = additional_property

        search_request_filters_evaluations_evaluator_id_has_score_type_2.additional_properties = additional_properties
        return search_request_filters_evaluations_evaluator_id_has_score_type_2

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> SearchRequestFiltersEvaluationsEvaluatorIdHasScoreType2AdditionalProperty:
        return self.additional_properties[key]

    def __setitem__(
        self, key: str, value: SearchRequestFiltersEvaluationsEvaluatorIdHasScoreType2AdditionalProperty
    ) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
