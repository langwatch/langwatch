from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_pull_request_usage_response_200_model_breakdown_item import (
        GetPullRequestUsageResponse200ModelBreakdownItem,
    )
    from ..models.get_pull_request_usage_response_200_pull_request import GetPullRequestUsageResponse200PullRequest
    from ..models.get_pull_request_usage_response_200_rows_item import GetPullRequestUsageResponse200RowsItem
    from ..models.get_pull_request_usage_response_200_totals import GetPullRequestUsageResponse200Totals


T = TypeVar("T", bound="GetPullRequestUsageResponse200")


@_attrs_define
class GetPullRequestUsageResponse200:
    """
    Attributes:
        pull_request (GetPullRequestUsageResponse200PullRequest):
        rows (list[GetPullRequestUsageResponse200RowsItem]):
        totals (GetPullRequestUsageResponse200Totals):
        model_breakdown (list[GetPullRequestUsageResponse200ModelBreakdownItem]):
    """

    pull_request: GetPullRequestUsageResponse200PullRequest
    rows: list[GetPullRequestUsageResponse200RowsItem]
    totals: GetPullRequestUsageResponse200Totals
    model_breakdown: list[GetPullRequestUsageResponse200ModelBreakdownItem]

    def to_dict(self) -> dict[str, Any]:
        pull_request = self.pull_request.to_dict()

        rows = []
        for rows_item_data in self.rows:
            rows_item = rows_item_data.to_dict()
            rows.append(rows_item)

        totals = self.totals.to_dict()

        model_breakdown = []
        for model_breakdown_item_data in self.model_breakdown:
            model_breakdown_item = model_breakdown_item_data.to_dict()
            model_breakdown.append(model_breakdown_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "pullRequest": pull_request,
                "rows": rows,
                "totals": totals,
                "modelBreakdown": model_breakdown,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_pull_request_usage_response_200_model_breakdown_item import (
            GetPullRequestUsageResponse200ModelBreakdownItem,
        )
        from ..models.get_pull_request_usage_response_200_pull_request import GetPullRequestUsageResponse200PullRequest
        from ..models.get_pull_request_usage_response_200_rows_item import GetPullRequestUsageResponse200RowsItem
        from ..models.get_pull_request_usage_response_200_totals import GetPullRequestUsageResponse200Totals

        d = dict(src_dict)
        pull_request = GetPullRequestUsageResponse200PullRequest.from_dict(d.pop("pullRequest"))

        rows = []
        _rows = d.pop("rows")
        for rows_item_data in _rows:
            rows_item = GetPullRequestUsageResponse200RowsItem.from_dict(rows_item_data)

            rows.append(rows_item)

        totals = GetPullRequestUsageResponse200Totals.from_dict(d.pop("totals"))

        model_breakdown = []
        _model_breakdown = d.pop("modelBreakdown")
        for model_breakdown_item_data in _model_breakdown:
            model_breakdown_item = GetPullRequestUsageResponse200ModelBreakdownItem.from_dict(model_breakdown_item_data)

            model_breakdown.append(model_breakdown_item)

        get_pull_request_usage_response_200 = cls(
            pull_request=pull_request,
            rows=rows,
            totals=totals,
            model_breakdown=model_breakdown,
        )

        return get_pull_request_usage_response_200
