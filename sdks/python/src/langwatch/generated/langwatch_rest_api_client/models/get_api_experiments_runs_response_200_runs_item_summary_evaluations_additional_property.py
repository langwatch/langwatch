from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiExperimentsRunsResponse200RunsItemSummaryEvaluationsAdditionalProperty")


@_attrs_define
class GetApiExperimentsRunsResponse200RunsItemSummaryEvaluationsAdditionalProperty:
    """
    Attributes:
        name (str):
        average_score (float | None):
        average_passed (float | Unset):
    """

    name: str
    average_score: float | None
    average_passed: float | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        average_score: float | None
        average_score = self.average_score

        average_passed = self.average_passed

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "averageScore": average_score,
            }
        )
        if average_passed is not UNSET:
            field_dict["averagePassed"] = average_passed

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        def _parse_average_score(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        average_score = _parse_average_score(d.pop("averageScore"))

        average_passed = d.pop("averagePassed", UNSET)

        get_api_experiments_runs_response_200_runs_item_summary_evaluations_additional_property = cls(
            name=name,
            average_score=average_score,
            average_passed=average_passed,
        )

        return get_api_experiments_runs_response_200_runs_item_summary_evaluations_additional_property
