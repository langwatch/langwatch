from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetPullRequestUsageResponse200Totals")


@_attrs_define
class GetPullRequestUsageResponse200Totals:
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

        get_pull_request_usage_response_200_totals = cls(
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

        return get_pull_request_usage_response_200_totals
