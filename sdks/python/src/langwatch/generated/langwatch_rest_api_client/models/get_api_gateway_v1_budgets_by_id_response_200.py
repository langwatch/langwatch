from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

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

    def to_dict(self) -> dict[str, Any]:
        budget = self.budget.to_dict()

        spend_available = self.spend_available

        field_dict: dict[str, Any] = {}

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

        return get_api_gateway_v1_budgets_by_id_response_200
