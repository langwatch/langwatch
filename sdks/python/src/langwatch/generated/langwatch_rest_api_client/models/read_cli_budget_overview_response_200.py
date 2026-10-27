from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.read_cli_budget_overview_response_200_reason import ReadCliBudgetOverviewResponse200Reason
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.read_cli_budget_overview_response_200_budgets_item import ReadCliBudgetOverviewResponse200BudgetsItem


T = TypeVar("T", bound="ReadCliBudgetOverviewResponse200")


@_attrs_define
class ReadCliBudgetOverviewResponse200:
    """
    Attributes:
        gateway_access (bool):
        budgets (list[ReadCliBudgetOverviewResponse200BudgetsItem]):
        reason (ReadCliBudgetOverviewResponse200Reason | Unset):
    """

    gateway_access: bool
    budgets: list[ReadCliBudgetOverviewResponse200BudgetsItem]
    reason: ReadCliBudgetOverviewResponse200Reason | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        gateway_access = self.gateway_access

        budgets = []
        for budgets_item_data in self.budgets:
            budgets_item = budgets_item_data.to_dict()
            budgets.append(budgets_item)

        reason: str | Unset = UNSET
        if not isinstance(self.reason, Unset):
            reason = self.reason.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "gatewayAccess": gateway_access,
                "budgets": budgets,
            }
        )
        if reason is not UNSET:
            field_dict["reason"] = reason

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.read_cli_budget_overview_response_200_budgets_item import (
            ReadCliBudgetOverviewResponse200BudgetsItem,
        )

        d = dict(src_dict)
        gateway_access = d.pop("gatewayAccess")

        budgets = []
        _budgets = d.pop("budgets")
        for budgets_item_data in _budgets:
            budgets_item = ReadCliBudgetOverviewResponse200BudgetsItem.from_dict(budgets_item_data)

            budgets.append(budgets_item)

        _reason = d.pop("reason", UNSET)
        reason: ReadCliBudgetOverviewResponse200Reason | Unset
        if isinstance(_reason, Unset):
            reason = UNSET
        else:
            reason = ReadCliBudgetOverviewResponse200Reason(_reason)

        read_cli_budget_overview_response_200 = cls(
            gateway_access=gateway_access,
            budgets=budgets,
            reason=reason,
        )

        return read_cli_budget_overview_response_200
