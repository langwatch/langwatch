from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiSimulationRunsResponse200RunsItemResultsType0EvaluationsItemCost")


@_attrs_define
class GetApiSimulationRunsResponse200RunsItemResultsType0EvaluationsItemCost:
    """
    Attributes:
        currency (str):
        amount (float):
    """

    currency: str
    amount: float

    def to_dict(self) -> dict[str, Any]:
        currency = self.currency

        amount = self.amount

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "currency": currency,
                "amount": amount,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        currency = d.pop("currency")

        amount = d.pop("amount")

        get_api_simulation_runs_response_200_runs_item_results_type_0_evaluations_item_cost = cls(
            currency=currency,
            amount=amount,
        )

        return get_api_simulation_runs_response_200_runs_item_results_type_0_evaluations_item_cost
