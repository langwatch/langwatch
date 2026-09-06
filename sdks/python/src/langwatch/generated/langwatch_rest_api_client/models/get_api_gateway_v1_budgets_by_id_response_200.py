from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_gateway_v1_budgets_by_id_response_200_budget import (
        GetApiGatewayV1BudgetsByIdResponse200Budget,
    )


T = TypeVar("T", bound="GetApiGatewayV1BudgetsByIdResponse200")


@_attrs_define
class GetApiGatewayV1BudgetsByIdResponse200:
    """
    Attributes:
        budget (GetApiGatewayV1BudgetsByIdResponse200Budget):
        spend_available (bool):
    """

    budget: GetApiGatewayV1BudgetsByIdResponse200Budget
    spend_available: bool
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        budget = self.budget.to_dict()

        spend_available = self.spend_available

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "budget": budget,
                "spend_available": spend_available,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_gateway_v1_budgets_by_id_response_200_budget import (
            GetApiGatewayV1BudgetsByIdResponse200Budget,
        )

        d = dict(src_dict)
        budget = GetApiGatewayV1BudgetsByIdResponse200Budget.from_dict(d.pop("budget"))

        spend_available = d.pop("spend_available")

        get_api_gateway_v1_budgets_by_id_response_200 = cls(
            budget=budget,
            spend_available=spend_available,
        )

        get_api_gateway_v1_budgets_by_id_response_200.additional_properties = d
        return get_api_gateway_v1_budgets_by_id_response_200

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
