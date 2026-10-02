from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_experiments_runs_response_200_runs_item_summary_evaluations_additional_property import (
        GetApiExperimentsRunsResponse200RunsItemSummaryEvaluationsAdditionalProperty,
    )


T = TypeVar("T", bound="GetApiExperimentsRunsResponse200RunsItemSummaryEvaluations")


@_attrs_define
class GetApiExperimentsRunsResponse200RunsItemSummaryEvaluations:
    """ """

    additional_properties: dict[str, GetApiExperimentsRunsResponse200RunsItemSummaryEvaluationsAdditionalProperty] = (
        _attrs_field(init=False, factory=dict)
    )

    def to_dict(self) -> dict[str, Any]:

        field_dict: dict[str, Any] = {}
        for prop_name, prop in self.additional_properties.items():
            field_dict[prop_name] = prop.to_dict()

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_experiments_runs_response_200_runs_item_summary_evaluations_additional_property import (
            GetApiExperimentsRunsResponse200RunsItemSummaryEvaluationsAdditionalProperty,
        )

        d = dict(src_dict)
        get_api_experiments_runs_response_200_runs_item_summary_evaluations = cls()

        additional_properties = {}
        for prop_name, prop_dict in d.items():
            additional_property = (
                GetApiExperimentsRunsResponse200RunsItemSummaryEvaluationsAdditionalProperty.from_dict(prop_dict)
            )

            additional_properties[prop_name] = additional_property

        get_api_experiments_runs_response_200_runs_item_summary_evaluations.additional_properties = (
            additional_properties
        )
        return get_api_experiments_runs_response_200_runs_item_summary_evaluations

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> GetApiExperimentsRunsResponse200RunsItemSummaryEvaluationsAdditionalProperty:
        return self.additional_properties[key]

    def __setitem__(
        self, key: str, value: GetApiExperimentsRunsResponse200RunsItemSummaryEvaluationsAdditionalProperty
    ) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
