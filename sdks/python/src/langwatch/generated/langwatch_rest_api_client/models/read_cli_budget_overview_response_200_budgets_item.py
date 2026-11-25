from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.read_cli_budget_overview_response_200_budgets_item_scope_class import (
    ReadCliBudgetOverviewResponse200BudgetsItemScopeClass,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.read_cli_budget_overview_response_200_budgets_item_top_models_item import (
        ReadCliBudgetOverviewResponse200BudgetsItemTopModelsItem,
    )


T = TypeVar("T", bound="ReadCliBudgetOverviewResponse200BudgetsItem")


@_attrs_define
class ReadCliBudgetOverviewResponse200BudgetsItem:
    """
    Attributes:
        id (str):
        name (str):
        scope_type (str):
        scope_id (str):
        scope_label (str):
        window (str):
        limit_usd (str):
        spent_usd (str):
        on_breach (str):
        timezone (None | str):
        provider_key (None | str):
        provider_label (None | str):
        is_per_member (bool):
        managed_by_virtual_key_id (None | str):
        scope_class (ReadCliBudgetOverviewResponse200BudgetsItemScopeClass):
        scope_phrase (str):
        resets_at (None | str):
        top_models (list[ReadCliBudgetOverviewResponse200BudgetsItemTopModelsItem] | Unset):
    """

    id: str
    name: str
    scope_type: str
    scope_id: str
    scope_label: str
    window: str
    limit_usd: str
    spent_usd: str
    on_breach: str
    timezone: None | str
    provider_key: None | str
    provider_label: None | str
    is_per_member: bool
    managed_by_virtual_key_id: None | str
    scope_class: ReadCliBudgetOverviewResponse200BudgetsItemScopeClass
    scope_phrase: str
    resets_at: None | str
    top_models: list[ReadCliBudgetOverviewResponse200BudgetsItemTopModelsItem] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        scope_type = self.scope_type

        scope_id = self.scope_id

        scope_label = self.scope_label

        window = self.window

        limit_usd = self.limit_usd

        spent_usd = self.spent_usd

        on_breach = self.on_breach

        timezone: None | str
        timezone = self.timezone

        provider_key: None | str
        provider_key = self.provider_key

        provider_label: None | str
        provider_label = self.provider_label

        is_per_member = self.is_per_member

        managed_by_virtual_key_id: None | str
        managed_by_virtual_key_id = self.managed_by_virtual_key_id

        scope_class = self.scope_class.value

        scope_phrase = self.scope_phrase

        resets_at: None | str
        resets_at = self.resets_at

        top_models: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.top_models, Unset):
            top_models = []
            for top_models_item_data in self.top_models:
                top_models_item = top_models_item_data.to_dict()
                top_models.append(top_models_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "scopeType": scope_type,
                "scopeId": scope_id,
                "scopeLabel": scope_label,
                "window": window,
                "limitUsd": limit_usd,
                "spentUsd": spent_usd,
                "onBreach": on_breach,
                "timezone": timezone,
                "providerKey": provider_key,
                "providerLabel": provider_label,
                "isPerMember": is_per_member,
                "managedByVirtualKeyId": managed_by_virtual_key_id,
                "scopeClass": scope_class,
                "scopePhrase": scope_phrase,
                "resetsAt": resets_at,
            }
        )
        if top_models is not UNSET:
            field_dict["topModels"] = top_models

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.read_cli_budget_overview_response_200_budgets_item_top_models_item import (
            ReadCliBudgetOverviewResponse200BudgetsItemTopModelsItem,
        )

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        scope_type = d.pop("scopeType")

        scope_id = d.pop("scopeId")

        scope_label = d.pop("scopeLabel")

        window = d.pop("window")

        limit_usd = d.pop("limitUsd")

        spent_usd = d.pop("spentUsd")

        on_breach = d.pop("onBreach")

        def _parse_timezone(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        timezone = _parse_timezone(d.pop("timezone"))

        def _parse_provider_key(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        provider_key = _parse_provider_key(d.pop("providerKey"))

        def _parse_provider_label(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        provider_label = _parse_provider_label(d.pop("providerLabel"))

        is_per_member = d.pop("isPerMember")

        def _parse_managed_by_virtual_key_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        managed_by_virtual_key_id = _parse_managed_by_virtual_key_id(d.pop("managedByVirtualKeyId"))

        scope_class = ReadCliBudgetOverviewResponse200BudgetsItemScopeClass(d.pop("scopeClass"))

        scope_phrase = d.pop("scopePhrase")

        def _parse_resets_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        resets_at = _parse_resets_at(d.pop("resetsAt"))

        _top_models = d.pop("topModels", UNSET)
        top_models: list[ReadCliBudgetOverviewResponse200BudgetsItemTopModelsItem] | Unset = UNSET
        if _top_models is not UNSET:
            top_models = []
            for top_models_item_data in _top_models:
                top_models_item = ReadCliBudgetOverviewResponse200BudgetsItemTopModelsItem.from_dict(
                    top_models_item_data
                )

                top_models.append(top_models_item)

        read_cli_budget_overview_response_200_budgets_item = cls(
            id=id,
            name=name,
            scope_type=scope_type,
            scope_id=scope_id,
            scope_label=scope_label,
            window=window,
            limit_usd=limit_usd,
            spent_usd=spent_usd,
            on_breach=on_breach,
            timezone=timezone,
            provider_key=provider_key,
            provider_label=provider_label,
            is_per_member=is_per_member,
            managed_by_virtual_key_id=managed_by_virtual_key_id,
            scope_class=scope_class,
            scope_phrase=scope_phrase,
            resets_at=resets_at,
            top_models=top_models,
        )

        return read_cli_budget_overview_response_200_budgets_item
