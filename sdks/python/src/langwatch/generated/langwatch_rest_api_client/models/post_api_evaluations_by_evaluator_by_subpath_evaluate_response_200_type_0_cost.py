from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse200Type0Cost")


@_attrs_define
class PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse200Type0Cost:
    """What running the evaluator cost

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

        post_api_evaluations_by_evaluator_by_subpath_evaluate_response_200_type_0_cost = cls(
            currency=currency,
            amount=amount,
        )

        return post_api_evaluations_by_evaluator_by_subpath_evaluate_response_200_type_0_cost
