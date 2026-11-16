from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="SpanInputOutputType3ValueCostType0")


@_attrs_define
class SpanInputOutputType3ValueCostType0:
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

        span_input_output_type_3_value_cost_type_0 = cls(
            currency=currency,
            amount=amount,
        )

        return span_input_output_type_3_value_cost_type_0
