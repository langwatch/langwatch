from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.patch_api_gateway_v1_virtual_keys_by_id_body_routing_mode import (
    PatchApiGatewayV1VirtualKeysByIdBodyRoutingMode,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.patch_api_gateway_v1_virtual_keys_by_id_body_budget_type_0 import (
        PatchApiGatewayV1VirtualKeysByIdBodyBudgetType0,
    )
    from ..models.patch_api_gateway_v1_virtual_keys_by_id_body_config import PatchApiGatewayV1VirtualKeysByIdBodyConfig
    from ..models.patch_api_gateway_v1_virtual_keys_by_id_body_metadata import (
        PatchApiGatewayV1VirtualKeysByIdBodyMetadata,
    )
    from ..models.patch_api_gateway_v1_virtual_keys_by_id_body_scopes_item import (
        PatchApiGatewayV1VirtualKeysByIdBodyScopesItem,
    )


T = TypeVar("T", bound="PatchApiGatewayV1VirtualKeysByIdBody")


@_attrs_define
class PatchApiGatewayV1VirtualKeysByIdBody:
    """
    Attributes:
        name (str | Unset):
        description (None | str | Unset):
        scopes (list[PatchApiGatewayV1VirtualKeysByIdBodyScopesItem] | Unset):
        trace_project_id (None | str | Unset): Where the key's traces and costs land. Omit it and the destination stays
            exactly where it is, scope edits included. A value moves it, validated the way create validates it. Explicit
            null does not clear it: it asks for the destination to be worked out again from what the key is now, under the
            same rules create uses. It lands on the key's single project scope when exactly one names a live project, and
            otherwise on the organization's oldest live governance project when there are no other live projects to choose
            from. An organization with live projects that could have been named refuses with
            `gateway_trace_project_ambiguous`, and one with no governance project to fall back on refuses with
            `trace_project_required`.
        routing_policy_id (None | str | Unset):
        routing_mode (PatchApiGatewayV1VirtualKeysByIdBodyRoutingMode | Unset):
        expires_at (None | str | Unset): When the key stops serving. Omit it and the stored date stays where it is; null
            clears it, so the key never expires; a date moves it. A key whose date has already passed accepts this edit like
            any other, which is how an expired key is put back in service without minting a new secret. A date in the past
            is refused with `virtual_key_expiry_in_past`.
        budget (None | PatchApiGatewayV1VirtualKeysByIdBodyBudgetType0 | Unset):
        config (PatchApiGatewayV1VirtualKeysByIdBodyConfig | Unset):
        external_id (None | str | Unset):
        metadata (PatchApiGatewayV1VirtualKeysByIdBodyMetadata | Unset):
    """

    name: str | Unset = UNSET
    description: None | str | Unset = UNSET
    scopes: list[PatchApiGatewayV1VirtualKeysByIdBodyScopesItem] | Unset = UNSET
    trace_project_id: None | str | Unset = UNSET
    routing_policy_id: None | str | Unset = UNSET
    routing_mode: PatchApiGatewayV1VirtualKeysByIdBodyRoutingMode | Unset = UNSET
    expires_at: None | str | Unset = UNSET
    budget: None | PatchApiGatewayV1VirtualKeysByIdBodyBudgetType0 | Unset = UNSET
    config: PatchApiGatewayV1VirtualKeysByIdBodyConfig | Unset = UNSET
    external_id: None | str | Unset = UNSET
    metadata: PatchApiGatewayV1VirtualKeysByIdBodyMetadata | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.patch_api_gateway_v1_virtual_keys_by_id_body_budget_type_0 import (
            PatchApiGatewayV1VirtualKeysByIdBodyBudgetType0,
        )

        name = self.name

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

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

        expires_at: None | str | Unset
        if isinstance(self.expires_at, Unset):
            expires_at = UNSET
        else:
            expires_at = self.expires_at

        budget: dict[str, Any] | None | Unset
        if isinstance(self.budget, Unset):
            budget = UNSET
        elif isinstance(self.budget, PatchApiGatewayV1VirtualKeysByIdBodyBudgetType0):
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

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if description is not UNSET:
            field_dict["description"] = description
        if scopes is not UNSET:
            field_dict["scopes"] = scopes
        if trace_project_id is not UNSET:
            field_dict["trace_project_id"] = trace_project_id
        if routing_policy_id is not UNSET:
            field_dict["routing_policy_id"] = routing_policy_id
        if routing_mode is not UNSET:
            field_dict["routing_mode"] = routing_mode
        if expires_at is not UNSET:
            field_dict["expires_at"] = expires_at
        if budget is not UNSET:
            field_dict["budget"] = budget
        if config is not UNSET:
            field_dict["config"] = config
        if external_id is not UNSET:
            field_dict["external_id"] = external_id
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.patch_api_gateway_v1_virtual_keys_by_id_body_budget_type_0 import (
            PatchApiGatewayV1VirtualKeysByIdBodyBudgetType0,
        )
        from ..models.patch_api_gateway_v1_virtual_keys_by_id_body_config import (
            PatchApiGatewayV1VirtualKeysByIdBodyConfig,
        )
        from ..models.patch_api_gateway_v1_virtual_keys_by_id_body_metadata import (
            PatchApiGatewayV1VirtualKeysByIdBodyMetadata,
        )
        from ..models.patch_api_gateway_v1_virtual_keys_by_id_body_scopes_item import (
            PatchApiGatewayV1VirtualKeysByIdBodyScopesItem,
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

        _scopes = d.pop("scopes", UNSET)
        scopes: list[PatchApiGatewayV1VirtualKeysByIdBodyScopesItem] | Unset = UNSET
        if _scopes is not UNSET:
            scopes = []
            for scopes_item_data in _scopes:
                scopes_item = PatchApiGatewayV1VirtualKeysByIdBodyScopesItem.from_dict(scopes_item_data)

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
        routing_mode: PatchApiGatewayV1VirtualKeysByIdBodyRoutingMode | Unset
        if isinstance(_routing_mode, Unset):
            routing_mode = UNSET
        else:
            routing_mode = PatchApiGatewayV1VirtualKeysByIdBodyRoutingMode(_routing_mode)

        def _parse_expires_at(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        expires_at = _parse_expires_at(d.pop("expires_at", UNSET))

        def _parse_budget(data: object) -> None | PatchApiGatewayV1VirtualKeysByIdBodyBudgetType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                budget_type_0 = PatchApiGatewayV1VirtualKeysByIdBodyBudgetType0.from_dict(data)

                return budget_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PatchApiGatewayV1VirtualKeysByIdBodyBudgetType0 | Unset, data)

        budget = _parse_budget(d.pop("budget", UNSET))

        _config = d.pop("config", UNSET)
        config: PatchApiGatewayV1VirtualKeysByIdBodyConfig | Unset
        if isinstance(_config, Unset):
            config = UNSET
        else:
            config = PatchApiGatewayV1VirtualKeysByIdBodyConfig.from_dict(_config)

        def _parse_external_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        external_id = _parse_external_id(d.pop("external_id", UNSET))

        _metadata = d.pop("metadata", UNSET)
        metadata: PatchApiGatewayV1VirtualKeysByIdBodyMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = PatchApiGatewayV1VirtualKeysByIdBodyMetadata.from_dict(_metadata)

        patch_api_gateway_v1_virtual_keys_by_id_body = cls(
            name=name,
            description=description,
            scopes=scopes,
            trace_project_id=trace_project_id,
            routing_policy_id=routing_policy_id,
            routing_mode=routing_mode,
            expires_at=expires_at,
            budget=budget,
            config=config,
            external_id=external_id,
            metadata=metadata,
        )

        patch_api_gateway_v1_virtual_keys_by_id_body.additional_properties = d
        return patch_api_gateway_v1_virtual_keys_by_id_body

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
