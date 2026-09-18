from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_gateway_v1_virtual_keys_body_routing_mode import PostApiGatewayV1VirtualKeysBodyRoutingMode
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_gateway_v1_virtual_keys_body_budget_type_0 import PostApiGatewayV1VirtualKeysBodyBudgetType0
    from ..models.post_api_gateway_v1_virtual_keys_body_config import PostApiGatewayV1VirtualKeysBodyConfig
    from ..models.post_api_gateway_v1_virtual_keys_body_metadata import PostApiGatewayV1VirtualKeysBodyMetadata
    from ..models.post_api_gateway_v1_virtual_keys_body_scopes_item import PostApiGatewayV1VirtualKeysBodyScopesItem


T = TypeVar("T", bound="PostApiGatewayV1VirtualKeysBody")


@_attrs_define
class PostApiGatewayV1VirtualKeysBody:
    """
    Attributes:
        name (str):
        description (str | Unset):
        principal_user_id (None | str | Unset):
        scopes (list[PostApiGatewayV1VirtualKeysBodyScopesItem] | Unset):
        trace_project_id (None | str | Unset):
        routing_policy_id (None | str | Unset):
        routing_mode (PostApiGatewayV1VirtualKeysBodyRoutingMode | Unset):
        budget (None | PostApiGatewayV1VirtualKeysBodyBudgetType0 | Unset):
        config (PostApiGatewayV1VirtualKeysBodyConfig | Unset):
        external_id (None | str | Unset):
        metadata (PostApiGatewayV1VirtualKeysBodyMetadata | Unset):
        purpose (Literal['user'] | Unset):
    """

    name: str
    description: str | Unset = UNSET
    principal_user_id: None | str | Unset = UNSET
    scopes: list[PostApiGatewayV1VirtualKeysBodyScopesItem] | Unset = UNSET
    trace_project_id: None | str | Unset = UNSET
    routing_policy_id: None | str | Unset = UNSET
    routing_mode: PostApiGatewayV1VirtualKeysBodyRoutingMode | Unset = UNSET
    budget: None | PostApiGatewayV1VirtualKeysBodyBudgetType0 | Unset = UNSET
    config: PostApiGatewayV1VirtualKeysBodyConfig | Unset = UNSET
    external_id: None | str | Unset = UNSET
    metadata: PostApiGatewayV1VirtualKeysBodyMetadata | Unset = UNSET
    purpose: Literal["user"] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_gateway_v1_virtual_keys_body_budget_type_0 import (
            PostApiGatewayV1VirtualKeysBodyBudgetType0,
        )

        name = self.name

        description = self.description

        principal_user_id: None | str | Unset
        if isinstance(self.principal_user_id, Unset):
            principal_user_id = UNSET
        else:
            principal_user_id = self.principal_user_id

        scopes: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.scopes, Unset):
            scopes = []
            for scopes_item_data in self.scopes:
                scopes_item = scopes_item_data.to_dict()
                scopes.append(scopes_item)

        trace_project_id: None | str | Unset
        if isinstance(self.trace_project_id, Unset):
            trace_project_id = UNSET
        else:
            trace_project_id = self.trace_project_id

        routing_policy_id: None | str | Unset
        if isinstance(self.routing_policy_id, Unset):
            routing_policy_id = UNSET
        else:
            routing_policy_id = self.routing_policy_id

        routing_mode: str | Unset = UNSET
        if not isinstance(self.routing_mode, Unset):
            routing_mode = self.routing_mode.value

        budget: dict[str, Any] | None | Unset
        if isinstance(self.budget, Unset):
            budget = UNSET
        elif isinstance(self.budget, PostApiGatewayV1VirtualKeysBodyBudgetType0):
            budget = self.budget.to_dict()
        else:
            budget = self.budget

        config: dict[str, Any] | Unset = UNSET
        if not isinstance(self.config, Unset):
            config = self.config.to_dict()

        external_id: None | str | Unset
        if isinstance(self.external_id, Unset):
            external_id = UNSET
        else:
            external_id = self.external_id

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        purpose = self.purpose

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if principal_user_id is not UNSET:
            field_dict["principal_user_id"] = principal_user_id
        if scopes is not UNSET:
            field_dict["scopes"] = scopes
        if trace_project_id is not UNSET:
            field_dict["trace_project_id"] = trace_project_id
        if routing_policy_id is not UNSET:
            field_dict["routing_policy_id"] = routing_policy_id
        if routing_mode is not UNSET:
            field_dict["routing_mode"] = routing_mode
        if budget is not UNSET:
            field_dict["budget"] = budget
        if config is not UNSET:
            field_dict["config"] = config
        if external_id is not UNSET:
            field_dict["external_id"] = external_id
        if metadata is not UNSET:
            field_dict["metadata"] = metadata
        if purpose is not UNSET:
            field_dict["purpose"] = purpose

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_gateway_v1_virtual_keys_body_budget_type_0 import (
            PostApiGatewayV1VirtualKeysBodyBudgetType0,
        )
        from ..models.post_api_gateway_v1_virtual_keys_body_config import PostApiGatewayV1VirtualKeysBodyConfig
        from ..models.post_api_gateway_v1_virtual_keys_body_metadata import PostApiGatewayV1VirtualKeysBodyMetadata
        from ..models.post_api_gateway_v1_virtual_keys_body_scopes_item import PostApiGatewayV1VirtualKeysBodyScopesItem

        d = dict(src_dict)
        name = d.pop("name")

        description = d.pop("description", UNSET)

        def _parse_principal_user_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        principal_user_id = _parse_principal_user_id(d.pop("principal_user_id", UNSET))

        _scopes = d.pop("scopes", UNSET)
        scopes: list[PostApiGatewayV1VirtualKeysBodyScopesItem] | Unset = UNSET
        if _scopes is not UNSET:
            scopes = []
            for scopes_item_data in _scopes:
                scopes_item = PostApiGatewayV1VirtualKeysBodyScopesItem.from_dict(scopes_item_data)

                scopes.append(scopes_item)

        def _parse_trace_project_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        trace_project_id = _parse_trace_project_id(d.pop("trace_project_id", UNSET))

        def _parse_routing_policy_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        routing_policy_id = _parse_routing_policy_id(d.pop("routing_policy_id", UNSET))

        _routing_mode = d.pop("routing_mode", UNSET)
        routing_mode: PostApiGatewayV1VirtualKeysBodyRoutingMode | Unset
        if isinstance(_routing_mode, Unset):
            routing_mode = UNSET
        else:
            routing_mode = PostApiGatewayV1VirtualKeysBodyRoutingMode(_routing_mode)

        def _parse_budget(data: object) -> None | PostApiGatewayV1VirtualKeysBodyBudgetType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                budget_type_0 = PostApiGatewayV1VirtualKeysBodyBudgetType0.from_dict(data)

                return budget_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PostApiGatewayV1VirtualKeysBodyBudgetType0 | Unset, data)

        budget = _parse_budget(d.pop("budget", UNSET))

        _config = d.pop("config", UNSET)
        config: PostApiGatewayV1VirtualKeysBodyConfig | Unset
        if isinstance(_config, Unset):
            config = UNSET
        else:
            config = PostApiGatewayV1VirtualKeysBodyConfig.from_dict(_config)

        def _parse_external_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        external_id = _parse_external_id(d.pop("external_id", UNSET))

        _metadata = d.pop("metadata", UNSET)
        metadata: PostApiGatewayV1VirtualKeysBodyMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = PostApiGatewayV1VirtualKeysBodyMetadata.from_dict(_metadata)

        purpose = cast(Literal["user"] | Unset, d.pop("purpose", UNSET))
        if purpose != "user" and not isinstance(purpose, Unset):
            raise ValueError(f"purpose must match const 'user', got '{purpose}'")

        post_api_gateway_v1_virtual_keys_body = cls(
            name=name,
            description=description,
            principal_user_id=principal_user_id,
            scopes=scopes,
            trace_project_id=trace_project_id,
            routing_policy_id=routing_policy_id,
            routing_mode=routing_mode,
            budget=budget,
            config=config,
            external_id=external_id,
            metadata=metadata,
            purpose=purpose,
        )

        post_api_gateway_v1_virtual_keys_body.additional_properties = d
        return post_api_gateway_v1_virtual_keys_body

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
