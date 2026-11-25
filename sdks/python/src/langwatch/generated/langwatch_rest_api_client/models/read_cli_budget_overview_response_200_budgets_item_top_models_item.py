from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ReadCliBudgetOverviewResponse200BudgetsItemTopModelsItem")


@_attrs_define
class ReadCliBudgetOverviewResponse200BudgetsItemTopModelsItem:
    """
    Attributes:
        model (str):
        spent_usd (float):
    """

    model: str
    spent_usd: float

    def to_dict(self) -> dict[str, Any]:
        model = self.model

        spent_usd = self.spent_usd

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "model": model,
                "spentUsd": spent_usd,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        model = d.pop("model")

        spent_usd = d.pop("spentUsd")

        read_cli_budget_overview_response_200_budgets_item_top_models_item = cls(
            model=model,
            spent_usd=spent_usd,
        )

        return read_cli_budget_overview_response_200_budgets_item_top_models_item
