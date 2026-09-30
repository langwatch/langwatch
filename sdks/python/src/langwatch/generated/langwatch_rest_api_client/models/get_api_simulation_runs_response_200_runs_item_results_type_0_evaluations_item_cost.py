from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        currency = self.currency

        amount = self.amount

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        get_api_simulation_runs_response_200_runs_item_results_type_0_evaluations_item_cost.additional_properties = d
        return get_api_simulation_runs_response_200_runs_item_results_type_0_evaluations_item_cost

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
