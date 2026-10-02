from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_gateway_v1_budgets_by_id_reset_response_200_budget import (
        PostApiGatewayV1BudgetsByIdResetResponse200Budget,
    )


T = TypeVar("T", bound="PostApiGatewayV1BudgetsByIdResetResponse200")


@_attrs_define
class PostApiGatewayV1BudgetsByIdResetResponse200:
    """
    Attributes:
        budget (PostApiGatewayV1BudgetsByIdResetResponse200Budget):
    """

    budget: PostApiGatewayV1BudgetsByIdResetResponse200Budget

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
        from ..models.post_api_gateway_v1_budgets_by_id_reset_response_200_budget import (
            PostApiGatewayV1BudgetsByIdResetResponse200Budget,
        )

        d = dict(src_dict)
        budget = PostApiGatewayV1BudgetsByIdResetResponse200Budget.from_dict(d.pop("budget"))

        post_api_gateway_v1_budgets_by_id_reset_response_200 = cls(
            budget=budget,
        )

        return post_api_gateway_v1_budgets_by_id_reset_response_200
