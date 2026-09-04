from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_coding_agent_pull_request_usage_response_200_model_breakdown_item import (
        GetApiCodingAgentPullRequestUsageResponse200ModelBreakdownItem,
    )
    from ..models.get_api_coding_agent_pull_request_usage_response_200_pull_request import (
        GetApiCodingAgentPullRequestUsageResponse200PullRequest,
    )
    from ..models.get_api_coding_agent_pull_request_usage_response_200_rows_item import (
        GetApiCodingAgentPullRequestUsageResponse200RowsItem,
    )
    from ..models.get_api_coding_agent_pull_request_usage_response_200_totals import (
        GetApiCodingAgentPullRequestUsageResponse200Totals,
    )


T = TypeVar("T", bound="GetApiCodingAgentPullRequestUsageResponse200")


@_attrs_define
class GetApiCodingAgentPullRequestUsageResponse200:
    """
    Attributes:
        pull_request (GetApiCodingAgentPullRequestUsageResponse200PullRequest):
        rows (list[GetApiCodingAgentPullRequestUsageResponse200RowsItem]):
        totals (GetApiCodingAgentPullRequestUsageResponse200Totals):
        model_breakdown (list[GetApiCodingAgentPullRequestUsageResponse200ModelBreakdownItem]):
    """

    pull_request: GetApiCodingAgentPullRequestUsageResponse200PullRequest
    rows: list[GetApiCodingAgentPullRequestUsageResponse200RowsItem]
    totals: GetApiCodingAgentPullRequestUsageResponse200Totals
    model_breakdown: list[GetApiCodingAgentPullRequestUsageResponse200ModelBreakdownItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

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
        field_dict.update(self.additional_properties)
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
        from ..models.get_api_coding_agent_pull_request_usage_response_200_model_breakdown_item import (
            GetApiCodingAgentPullRequestUsageResponse200ModelBreakdownItem,
        )
        from ..models.get_api_coding_agent_pull_request_usage_response_200_pull_request import (
            GetApiCodingAgentPullRequestUsageResponse200PullRequest,
        )
        from ..models.get_api_coding_agent_pull_request_usage_response_200_rows_item import (
            GetApiCodingAgentPullRequestUsageResponse200RowsItem,
        )
        from ..models.get_api_coding_agent_pull_request_usage_response_200_totals import (
            GetApiCodingAgentPullRequestUsageResponse200Totals,
        )

        d = dict(src_dict)
        pull_request = GetApiCodingAgentPullRequestUsageResponse200PullRequest.from_dict(d.pop("pullRequest"))

        rows = []
        _rows = d.pop("rows")
        for rows_item_data in _rows:
            rows_item = GetApiCodingAgentPullRequestUsageResponse200RowsItem.from_dict(rows_item_data)

            rows.append(rows_item)

        totals = GetApiCodingAgentPullRequestUsageResponse200Totals.from_dict(d.pop("totals"))

        model_breakdown = []
        _model_breakdown = d.pop("modelBreakdown")
        for model_breakdown_item_data in _model_breakdown:
            model_breakdown_item = GetApiCodingAgentPullRequestUsageResponse200ModelBreakdownItem.from_dict(
                model_breakdown_item_data
            )

            model_breakdown.append(model_breakdown_item)

        get_api_coding_agent_pull_request_usage_response_200 = cls(
            pull_request=pull_request,
            rows=rows,
            totals=totals,
            model_breakdown=model_breakdown,
        )

        get_api_coding_agent_pull_request_usage_response_200.additional_properties = d
        return get_api_coding_agent_pull_request_usage_response_200

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
