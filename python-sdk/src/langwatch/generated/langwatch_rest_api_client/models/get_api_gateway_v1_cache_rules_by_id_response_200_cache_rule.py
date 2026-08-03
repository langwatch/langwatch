from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_gateway_v1_cache_rules_by_id_response_200_cache_rule_mode_enum import (
    GetApiGatewayV1CacheRulesByIdResponse200CacheRuleModeEnum,
)

if TYPE_CHECKING:
    from ..models.get_api_gateway_v1_cache_rules_by_id_response_200_cache_rule_action import (
        GetApiGatewayV1CacheRulesByIdResponse200CacheRuleAction,
    )
    from ..models.get_api_gateway_v1_cache_rules_by_id_response_200_cache_rule_matchers import (
        GetApiGatewayV1CacheRulesByIdResponse200CacheRuleMatchers,
    )


T = TypeVar("T", bound="GetApiGatewayV1CacheRulesByIdResponse200CacheRule")


@_attrs_define
class GetApiGatewayV1CacheRulesByIdResponse200CacheRule:
    """
    Attributes:
        id (str):
        organization_id (str):
        name (str):
        description (None | str):
        priority (int):
        enabled (bool):
        matchers (GetApiGatewayV1CacheRulesByIdResponse200CacheRuleMatchers):
        action (GetApiGatewayV1CacheRulesByIdResponse200CacheRuleAction):
        mode_enum (GetApiGatewayV1CacheRulesByIdResponse200CacheRuleModeEnum):
        archived_at (None | str):
        created_at (str):
        updated_at (str):
    """

    id: str
    organization_id: str
    name: str
    description: None | str
    priority: int
    enabled: bool
    matchers: GetApiGatewayV1CacheRulesByIdResponse200CacheRuleMatchers
    action: GetApiGatewayV1CacheRulesByIdResponse200CacheRuleAction
    mode_enum: GetApiGatewayV1CacheRulesByIdResponse200CacheRuleModeEnum
    archived_at: None | str
    created_at: str
    updated_at: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        organization_id = self.organization_id

        name = self.name

        description: None | str
        description = self.description

        priority = self.priority

        enabled = self.enabled

        matchers = self.matchers.to_dict()

        action = self.action.to_dict()

        mode_enum = self.mode_enum.value

        archived_at: None | str
        archived_at = self.archived_at

        created_at = self.created_at

        updated_at = self.updated_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "organization_id": organization_id,
                "name": name,
                "description": description,
                "priority": priority,
                "enabled": enabled,
                "matchers": matchers,
                "action": action,
                "mode_enum": mode_enum,
                "archived_at": archived_at,
                "created_at": created_at,
                "updated_at": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_gateway_v1_cache_rules_by_id_response_200_cache_rule_action import (
            GetApiGatewayV1CacheRulesByIdResponse200CacheRuleAction,
        )
        from ..models.get_api_gateway_v1_cache_rules_by_id_response_200_cache_rule_matchers import (
            GetApiGatewayV1CacheRulesByIdResponse200CacheRuleMatchers,
        )

        d = dict(src_dict)
        id = d.pop("id")

        organization_id = d.pop("organization_id")

        name = d.pop("name")

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))

        priority = d.pop("priority")

        enabled = d.pop("enabled")

        matchers = GetApiGatewayV1CacheRulesByIdResponse200CacheRuleMatchers.from_dict(d.pop("matchers"))

        action = GetApiGatewayV1CacheRulesByIdResponse200CacheRuleAction.from_dict(d.pop("action"))

        mode_enum = GetApiGatewayV1CacheRulesByIdResponse200CacheRuleModeEnum(d.pop("mode_enum"))

        def _parse_archived_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        archived_at = _parse_archived_at(d.pop("archived_at"))

        created_at = d.pop("created_at")

        updated_at = d.pop("updated_at")

        get_api_gateway_v1_cache_rules_by_id_response_200_cache_rule = cls(
            id=id,
            organization_id=organization_id,
            name=name,
            description=description,
            priority=priority,
            enabled=enabled,
            matchers=matchers,
            action=action,
            mode_enum=mode_enum,
            archived_at=archived_at,
            created_at=created_at,
            updated_at=updated_at,
        )

        get_api_gateway_v1_cache_rules_by_id_response_200_cache_rule.additional_properties = d
        return get_api_gateway_v1_cache_rules_by_id_response_200_cache_rule

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
