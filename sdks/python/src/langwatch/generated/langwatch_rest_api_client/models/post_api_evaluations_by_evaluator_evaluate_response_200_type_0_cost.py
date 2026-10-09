from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiEvaluationsByEvaluatorEvaluateResponse200Type0Cost")


@_attrs_define
class PostApiEvaluationsByEvaluatorEvaluateResponse200Type0Cost:
    """What running the evaluator cost

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

        post_api_evaluations_by_evaluator_evaluate_response_200_type_0_cost = cls(
            currency=currency,
            amount=amount,
        )

        post_api_evaluations_by_evaluator_evaluate_response_200_type_0_cost.additional_properties = d
        return post_api_evaluations_by_evaluator_evaluate_response_200_type_0_cost

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
