from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.patch_api_gateway_v1_virtual_keys_by_id_body_config_cache import (
        PatchApiGatewayV1VirtualKeysByIdBodyConfigCache,
    )
    from ..models.patch_api_gateway_v1_virtual_keys_by_id_body_config_fallback import (
        PatchApiGatewayV1VirtualKeysByIdBodyConfigFallback,
    )
    from ..models.patch_api_gateway_v1_virtual_keys_by_id_body_config_guardrail_attachments_item import (
        PatchApiGatewayV1VirtualKeysByIdBodyConfigGuardrailAttachmentsItem,
    )
    from ..models.patch_api_gateway_v1_virtual_keys_by_id_body_config_metadata import (
        PatchApiGatewayV1VirtualKeysByIdBodyConfigMetadata,
    )
    from ..models.patch_api_gateway_v1_virtual_keys_by_id_body_config_rate_limits import (
        PatchApiGatewayV1VirtualKeysByIdBodyConfigRateLimits,
    )


T = TypeVar("T", bound="PatchApiGatewayV1VirtualKeysByIdBodyConfig")


@_attrs_define
class PatchApiGatewayV1VirtualKeysByIdBodyConfig:
    """
    Attributes:
        models_allowed (list[str] | None | Unset):
        providers_allowed (list[str] | None | Unset):
        cache (PatchApiGatewayV1VirtualKeysByIdBodyConfigCache | Unset):
        fallback (PatchApiGatewayV1VirtualKeysByIdBodyConfigFallback | Unset):
        guardrail_attachments (list[PatchApiGatewayV1VirtualKeysByIdBodyConfigGuardrailAttachmentsItem] | Unset):
        rate_limits (PatchApiGatewayV1VirtualKeysByIdBodyConfigRateLimits | Unset):
        metadata (PatchApiGatewayV1VirtualKeysByIdBodyConfigMetadata | Unset):
    """

    models_allowed: list[str] | None | Unset = UNSET
    providers_allowed: list[str] | None | Unset = UNSET
    cache: PatchApiGatewayV1VirtualKeysByIdBodyConfigCache | Unset = UNSET
    fallback: PatchApiGatewayV1VirtualKeysByIdBodyConfigFallback | Unset = UNSET
    guardrail_attachments: list[PatchApiGatewayV1VirtualKeysByIdBodyConfigGuardrailAttachmentsItem] | Unset = UNSET
    rate_limits: PatchApiGatewayV1VirtualKeysByIdBodyConfigRateLimits | Unset = UNSET
    metadata: PatchApiGatewayV1VirtualKeysByIdBodyConfigMetadata | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        models_allowed: list[str] | None | Unset
        if isinstance(self.models_allowed, Unset):
            models_allowed = UNSET
        elif isinstance(self.models_allowed, list):
            models_allowed = self.models_allowed

        else:
            models_allowed = self.models_allowed

        providers_allowed: list[str] | None | Unset
        if isinstance(self.providers_allowed, Unset):
            providers_allowed = UNSET
        elif isinstance(self.providers_allowed, list):
            providers_allowed = self.providers_allowed

        else:
            providers_allowed = self.providers_allowed

        cache: dict[str, Any] | Unset = UNSET
        if not isinstance(self.cache, Unset):
            cache = self.cache.to_dict()

        fallback: dict[str, Any] | Unset = UNSET
        if not isinstance(self.fallback, Unset):
            fallback = self.fallback.to_dict()

        guardrail_attachments: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.guardrail_attachments, Unset):
            guardrail_attachments = []
            for guardrail_attachments_item_data in self.guardrail_attachments:
                guardrail_attachments_item = guardrail_attachments_item_data.to_dict()
                guardrail_attachments.append(guardrail_attachments_item)

        rate_limits: dict[str, Any] | Unset = UNSET
        if not isinstance(self.rate_limits, Unset):
            rate_limits = self.rate_limits.to_dict()

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if models_allowed is not UNSET:
            field_dict["modelsAllowed"] = models_allowed
        if providers_allowed is not UNSET:
            field_dict["providersAllowed"] = providers_allowed
        if cache is not UNSET:
            field_dict["cache"] = cache
        if fallback is not UNSET:
            field_dict["fallback"] = fallback
        if guardrail_attachments is not UNSET:
            field_dict["guardrailAttachments"] = guardrail_attachments
        if rate_limits is not UNSET:
            field_dict["rateLimits"] = rate_limits
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.patch_api_gateway_v1_virtual_keys_by_id_body_config_cache import (
            PatchApiGatewayV1VirtualKeysByIdBodyConfigCache,
        )
        from ..models.patch_api_gateway_v1_virtual_keys_by_id_body_config_fallback import (
            PatchApiGatewayV1VirtualKeysByIdBodyConfigFallback,
        )
        from ..models.patch_api_gateway_v1_virtual_keys_by_id_body_config_guardrail_attachments_item import (
            PatchApiGatewayV1VirtualKeysByIdBodyConfigGuardrailAttachmentsItem,
        )
        from ..models.patch_api_gateway_v1_virtual_keys_by_id_body_config_metadata import (
            PatchApiGatewayV1VirtualKeysByIdBodyConfigMetadata,
        )
        from ..models.patch_api_gateway_v1_virtual_keys_by_id_body_config_rate_limits import (
            PatchApiGatewayV1VirtualKeysByIdBodyConfigRateLimits,
        )

        d = dict(src_dict)

        def _parse_models_allowed(data: object) -> list[str] | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                models_allowed_type_0 = cast(list[str], data)

                return models_allowed_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[str] | None | Unset, data)

        models_allowed = _parse_models_allowed(d.pop("modelsAllowed", UNSET))

        def _parse_providers_allowed(data: object) -> list[str] | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                providers_allowed_type_0 = cast(list[str], data)

                return providers_allowed_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[str] | None | Unset, data)

        providers_allowed = _parse_providers_allowed(d.pop("providersAllowed", UNSET))

        _cache = d.pop("cache", UNSET)
        cache: PatchApiGatewayV1VirtualKeysByIdBodyConfigCache | Unset
        if isinstance(_cache, Unset):
            cache = UNSET
        else:
            cache = PatchApiGatewayV1VirtualKeysByIdBodyConfigCache.from_dict(_cache)

        _fallback = d.pop("fallback", UNSET)
        fallback: PatchApiGatewayV1VirtualKeysByIdBodyConfigFallback | Unset
        if isinstance(_fallback, Unset):
            fallback = UNSET
        else:
            fallback = PatchApiGatewayV1VirtualKeysByIdBodyConfigFallback.from_dict(_fallback)

        _guardrail_attachments = d.pop("guardrailAttachments", UNSET)
        guardrail_attachments: list[PatchApiGatewayV1VirtualKeysByIdBodyConfigGuardrailAttachmentsItem] | Unset = UNSET
        if _guardrail_attachments is not UNSET:
            guardrail_attachments = []
            for guardrail_attachments_item_data in _guardrail_attachments:
                guardrail_attachments_item = (
                    PatchApiGatewayV1VirtualKeysByIdBodyConfigGuardrailAttachmentsItem.from_dict(
                        guardrail_attachments_item_data
                    )
                )

                guardrail_attachments.append(guardrail_attachments_item)

        _rate_limits = d.pop("rateLimits", UNSET)
        rate_limits: PatchApiGatewayV1VirtualKeysByIdBodyConfigRateLimits | Unset
        if isinstance(_rate_limits, Unset):
            rate_limits = UNSET
        else:
            rate_limits = PatchApiGatewayV1VirtualKeysByIdBodyConfigRateLimits.from_dict(_rate_limits)

        _metadata = d.pop("metadata", UNSET)
        metadata: PatchApiGatewayV1VirtualKeysByIdBodyConfigMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = PatchApiGatewayV1VirtualKeysByIdBodyConfigMetadata.from_dict(_metadata)

        patch_api_gateway_v1_virtual_keys_by_id_body_config = cls(
            models_allowed=models_allowed,
            providers_allowed=providers_allowed,
            cache=cache,
            fallback=fallback,
            guardrail_attachments=guardrail_attachments,
            rate_limits=rate_limits,
            metadata=metadata,
        )

        patch_api_gateway_v1_virtual_keys_by_id_body_config.additional_properties = d
        return patch_api_gateway_v1_virtual_keys_by_id_body_config

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
