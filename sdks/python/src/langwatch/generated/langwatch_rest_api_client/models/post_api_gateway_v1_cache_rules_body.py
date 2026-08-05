from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_gateway_v1_cache_rules_body_action import PostApiGatewayV1CacheRulesBodyAction
    from ..models.post_api_gateway_v1_cache_rules_body_matchers import PostApiGatewayV1CacheRulesBodyMatchers


T = TypeVar("T", bound="PostApiGatewayV1CacheRulesBody")


@_attrs_define
class PostApiGatewayV1CacheRulesBody:
    """
    Attributes:
        name (str):
        matchers (PostApiGatewayV1CacheRulesBodyMatchers):
        action (PostApiGatewayV1CacheRulesBodyAction):
        description (None | str | Unset):
        priority (int | Unset):
        enabled (bool | Unset):
    """

    name: str
    matchers: PostApiGatewayV1CacheRulesBodyMatchers
    action: PostApiGatewayV1CacheRulesBodyAction
    description: None | str | Unset = UNSET
    priority: int | Unset = UNSET
    enabled: bool | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        matchers = self.matchers.to_dict()

        action = self.action.to_dict()

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        priority = self.priority

        enabled = self.enabled

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "matchers": matchers,
                "action": action,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if priority is not UNSET:
            field_dict["priority"] = priority
        if enabled is not UNSET:
            field_dict["enabled"] = enabled

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_gateway_v1_cache_rules_body_action import PostApiGatewayV1CacheRulesBodyAction
        from ..models.post_api_gateway_v1_cache_rules_body_matchers import PostApiGatewayV1CacheRulesBodyMatchers

        d = dict(src_dict)
        name = d.pop("name")

        matchers = PostApiGatewayV1CacheRulesBodyMatchers.from_dict(d.pop("matchers"))

        action = PostApiGatewayV1CacheRulesBodyAction.from_dict(d.pop("action"))

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))

        priority = d.pop("priority", UNSET)

        enabled = d.pop("enabled", UNSET)

        post_api_gateway_v1_cache_rules_body = cls(
            name=name,
            matchers=matchers,
            action=action,
            description=description,
            priority=priority,
            enabled=enabled,
        )

        post_api_gateway_v1_cache_rules_body.additional_properties = d
        return post_api_gateway_v1_cache_rules_body

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
