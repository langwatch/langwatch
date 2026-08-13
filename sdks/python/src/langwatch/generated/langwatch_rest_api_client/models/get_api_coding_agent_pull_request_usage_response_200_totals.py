from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetApiCodingAgentPullRequestUsageResponse200Totals")


@_attrs_define
class GetApiCodingAgentPullRequestUsageResponse200Totals:
    """
    Attributes:
        sessions_count (float):
        input_tokens (float):
        output_tokens (float):
        cache_read_tokens (float):
        cache_creation_tokens (float):
        total_tokens (float):
        cost_usd (float | None):
        billed_cost_usd (float | None):
        non_billed_cost_usd (float | None):
    """

    sessions_count: float
    input_tokens: float
    output_tokens: float
    cache_read_tokens: float
    cache_creation_tokens: float
    total_tokens: float
    cost_usd: float | None
    billed_cost_usd: float | None
    non_billed_cost_usd: float | None
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        sessions_count = self.sessions_count

        input_tokens = self.input_tokens

        output_tokens = self.output_tokens

        cache_read_tokens = self.cache_read_tokens

        cache_creation_tokens = self.cache_creation_tokens

        total_tokens = self.total_tokens

        cost_usd: float | None
        cost_usd = self.cost_usd

        billed_cost_usd: float | None
        billed_cost_usd = self.billed_cost_usd

        non_billed_cost_usd: float | None
        non_billed_cost_usd = self.non_billed_cost_usd

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "sessionsCount": sessions_count,
                "inputTokens": input_tokens,
                "outputTokens": output_tokens,
                "cacheReadTokens": cache_read_tokens,
                "cacheCreationTokens": cache_creation_tokens,
                "totalTokens": total_tokens,
                "costUsd": cost_usd,
                "billedCostUsd": billed_cost_usd,
                "nonBilledCostUsd": non_billed_cost_usd,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        sessions_count = d.pop("sessionsCount")

        input_tokens = d.pop("inputTokens")

        output_tokens = d.pop("outputTokens")

        cache_read_tokens = d.pop("cacheReadTokens")

        cache_creation_tokens = d.pop("cacheCreationTokens")

        total_tokens = d.pop("totalTokens")

        def _parse_cost_usd(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        cost_usd = _parse_cost_usd(d.pop("costUsd"))

        def _parse_billed_cost_usd(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        billed_cost_usd = _parse_billed_cost_usd(d.pop("billedCostUsd"))

        def _parse_non_billed_cost_usd(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        non_billed_cost_usd = _parse_non_billed_cost_usd(d.pop("nonBilledCostUsd"))

        get_api_coding_agent_pull_request_usage_response_200_totals = cls(
            sessions_count=sessions_count,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_read_tokens=cache_read_tokens,
            cache_creation_tokens=cache_creation_tokens,
            total_tokens=total_tokens,
            cost_usd=cost_usd,
            billed_cost_usd=billed_cost_usd,
            non_billed_cost_usd=non_billed_cost_usd,
        )

        get_api_coding_agent_pull_request_usage_response_200_totals.additional_properties = d
        return get_api_coding_agent_pull_request_usage_response_200_totals

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
