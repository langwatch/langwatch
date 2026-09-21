from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.patch_api_gateway_v1_cache_rules_by_id_body_action import PatchApiGatewayV1CacheRulesByIdBodyAction
    from ..models.patch_api_gateway_v1_cache_rules_by_id_body_matchers import (
        PatchApiGatewayV1CacheRulesByIdBodyMatchers,
    )


T = TypeVar("T", bound="PatchApiGatewayV1CacheRulesByIdBody")


@_attrs_define
class PatchApiGatewayV1CacheRulesByIdBody:
    """
    Attributes:
        name (str | Unset):
        description (None | str | Unset):
        priority (int | Unset):
        enabled (bool | Unset):
        matchers (PatchApiGatewayV1CacheRulesByIdBodyMatchers | Unset):
        action (PatchApiGatewayV1CacheRulesByIdBodyAction | Unset):
    """

    name: str | Unset = UNSET
    description: None | str | Unset = UNSET
    priority: int | Unset = UNSET
    enabled: bool | Unset = UNSET
    matchers: PatchApiGatewayV1CacheRulesByIdBodyMatchers | Unset = UNSET
    action: PatchApiGatewayV1CacheRulesByIdBodyAction | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        priority = self.priority

        enabled = self.enabled

        matchers: dict[str, Any] | Unset = UNSET
        if not isinstance(self.matchers, Unset):
            matchers = self.matchers.to_dict()

        action: dict[str, Any] | Unset = UNSET
        if not isinstance(self.action, Unset):
            action = self.action.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if description is not UNSET:
            field_dict["description"] = description
        if priority is not UNSET:
            field_dict["priority"] = priority
        if enabled is not UNSET:
            field_dict["enabled"] = enabled
        if matchers is not UNSET:
            field_dict["matchers"] = matchers
        if action is not UNSET:
            field_dict["action"] = action

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.patch_api_gateway_v1_cache_rules_by_id_body_action import (
            PatchApiGatewayV1CacheRulesByIdBodyAction,
        )
        from ..models.patch_api_gateway_v1_cache_rules_by_id_body_matchers import (
            PatchApiGatewayV1CacheRulesByIdBodyMatchers,
        )

        d = dict(src_dict)
        name = d.pop("name", UNSET)

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))

        priority = d.pop("priority", UNSET)

        enabled = d.pop("enabled", UNSET)

        _matchers = d.pop("matchers", UNSET)
        matchers: PatchApiGatewayV1CacheRulesByIdBodyMatchers | Unset
        if isinstance(_matchers, Unset):
            matchers = UNSET
        else:
            matchers = PatchApiGatewayV1CacheRulesByIdBodyMatchers.from_dict(_matchers)

        _action = d.pop("action", UNSET)
        action: PatchApiGatewayV1CacheRulesByIdBodyAction | Unset
        if isinstance(_action, Unset):
            action = UNSET
        else:
            action = PatchApiGatewayV1CacheRulesByIdBodyAction.from_dict(_action)

        patch_api_gateway_v1_cache_rules_by_id_body = cls(
            name=name,
            description=description,
            priority=priority,
            enabled=enabled,
            matchers=matchers,
            action=action,
        )

        patch_api_gateway_v1_cache_rules_by_id_body.additional_properties = d
        return patch_api_gateway_v1_cache_rules_by_id_body

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
