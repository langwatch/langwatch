from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_experiments_runs_response_200_pagination import GetApiExperimentsRunsResponse200Pagination
    from ..models.get_api_experiments_runs_response_200_runs_item import GetApiExperimentsRunsResponse200RunsItem


T = TypeVar("T", bound="GetApiExperimentsRunsResponse200")


@_attrs_define
class GetApiExperimentsRunsResponse200:
    """
    Attributes:
        experiment_id (str):
        experiment_slug (str):
        runs (list[GetApiExperimentsRunsResponse200RunsItem]):
        pagination (GetApiExperimentsRunsResponse200Pagination):
    """

    experiment_id: str
    experiment_slug: str
    runs: list[GetApiExperimentsRunsResponse200RunsItem]
    pagination: GetApiExperimentsRunsResponse200Pagination

    def to_dict(self) -> dict[str, Any]:
        experiment_id = self.experiment_id

        experiment_slug = self.experiment_slug

        runs = []
        for runs_item_data in self.runs:
            runs_item = runs_item_data.to_dict()
            runs.append(runs_item)

        pagination = self.pagination.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "experimentId": experiment_id,
                "experimentSlug": experiment_slug,
                "runs": runs,
                "pagination": pagination,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_experiments_runs_response_200_pagination import GetApiExperimentsRunsResponse200Pagination
        from ..models.get_api_experiments_runs_response_200_runs_item import GetApiExperimentsRunsResponse200RunsItem

        d = dict(src_dict)
        experiment_id = d.pop("experimentId")

        experiment_slug = d.pop("experimentSlug")

        runs = []
        _runs = d.pop("runs")
        for runs_item_data in _runs:
            runs_item = GetApiExperimentsRunsResponse200RunsItem.from_dict(runs_item_data)

            runs.append(runs_item)

        pagination = GetApiExperimentsRunsResponse200Pagination.from_dict(d.pop("pagination"))

        get_api_experiments_runs_response_200 = cls(
            experiment_id=experiment_id,
            experiment_slug=experiment_slug,
            runs=runs,
            pagination=pagination,
        )

        return get_api_experiments_runs_response_200
