from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_gateway_v1_budgets_response_201_budget import PostApiGatewayV1BudgetsResponse201Budget


T = TypeVar("T", bound="PostApiGatewayV1BudgetsResponse201")


@_attrs_define
class PostApiGatewayV1BudgetsResponse201:
    """
    Attributes:
        budget (PostApiGatewayV1BudgetsResponse201Budget):
    """

    budget: PostApiGatewayV1BudgetsResponse201Budget

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
        from ..models.post_api_gateway_v1_budgets_response_201_budget import PostApiGatewayV1BudgetsResponse201Budget

        d = dict(src_dict)
        budget = PostApiGatewayV1BudgetsResponse201Budget.from_dict(d.pop("budget"))

        post_api_gateway_v1_budgets_response_201 = cls(
            budget=budget,
        )

        return post_api_gateway_v1_budgets_response_201
