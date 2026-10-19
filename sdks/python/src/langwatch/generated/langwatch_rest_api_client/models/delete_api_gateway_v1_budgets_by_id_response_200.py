from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.delete_api_gateway_v1_budgets_by_id_response_200_budget import (
        DeleteApiGatewayV1BudgetsByIdResponse200Budget,
    )


T = TypeVar("T", bound="DeleteApiGatewayV1BudgetsByIdResponse200")


@_attrs_define
class DeleteApiGatewayV1BudgetsByIdResponse200:
    """
    Attributes:
        budget (DeleteApiGatewayV1BudgetsByIdResponse200Budget):
    """

    budget: DeleteApiGatewayV1BudgetsByIdResponse200Budget

    def to_dict(self) -> dict[str, Any]:
        budget = self.budget.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "budget": budget,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.delete_api_gateway_v1_budgets_by_id_response_200_budget import (
            DeleteApiGatewayV1BudgetsByIdResponse200Budget,
        )

        d = dict(src_dict)
        budget = DeleteApiGatewayV1BudgetsByIdResponse200Budget.from_dict(d.pop("budget"))

        delete_api_gateway_v1_budgets_by_id_response_200 = cls(
            budget=budget,
        )

        return delete_api_gateway_v1_budgets_by_id_response_200
