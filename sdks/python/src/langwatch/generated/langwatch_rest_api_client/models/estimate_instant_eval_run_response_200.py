from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="EstimateInstantEvalRunResponse200")


@_attrs_define
class EstimateInstantEvalRunResponse200:
    """
    Attributes:
        rows (int): Rows the statement matches, bounded by the run's limit.
        is_rows_capped (bool): Whether the statement matches more rows than the run may judge.
        avg_tokens (int): Input tokens one judged row sends, measured from a sample.
        total_tokens (int): Input tokens the whole run would send.
        requests (int): Classifications the run would make, one per judged row.
        price_usd (float): What the run would cost you, in United States dollars.
        free_budget_remaining_usd (float | Unset): What is left of the free Instant Evals budget, in United States
            dollars. Only present for an organization without a paid plan.
    """

    rows: int
    is_rows_capped: bool
    avg_tokens: int
    total_tokens: int
    requests: int
    price_usd: float
    free_budget_remaining_usd: float | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        rows = self.rows

        is_rows_capped = self.is_rows_capped

        avg_tokens = self.avg_tokens

        total_tokens = self.total_tokens

        requests = self.requests

        price_usd = self.price_usd

        free_budget_remaining_usd = self.free_budget_remaining_usd

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "rows": rows,
                "isRowsCapped": is_rows_capped,
                "avgTokens": avg_tokens,
                "totalTokens": total_tokens,
                "requests": requests,
                "priceUsd": price_usd,
            }
        )
        if free_budget_remaining_usd is not UNSET:
            field_dict["freeBudgetRemainingUsd"] = free_budget_remaining_usd

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        rows = d.pop("rows")

        is_rows_capped = d.pop("isRowsCapped")

        avg_tokens = d.pop("avgTokens")

        total_tokens = d.pop("totalTokens")

        requests = d.pop("requests")

        price_usd = d.pop("priceUsd")

        free_budget_remaining_usd = d.pop("freeBudgetRemainingUsd", UNSET)

        estimate_instant_eval_run_response_200 = cls(
            rows=rows,
            is_rows_capped=is_rows_capped,
            avg_tokens=avg_tokens,
            total_tokens=total_tokens,
            requests=requests,
            price_usd=price_usd,
            free_budget_remaining_usd=free_budget_remaining_usd,
        )

        estimate_instant_eval_run_response_200.additional_properties = d
        return estimate_instant_eval_run_response_200

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
