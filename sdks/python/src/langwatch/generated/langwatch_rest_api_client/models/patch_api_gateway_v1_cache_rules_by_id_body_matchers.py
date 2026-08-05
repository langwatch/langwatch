from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.patch_api_gateway_v1_cache_rules_by_id_body_matchers_request_metadata import (
        PatchApiGatewayV1CacheRulesByIdBodyMatchersRequestMetadata,
    )


T = TypeVar("T", bound="PatchApiGatewayV1CacheRulesByIdBodyMatchers")


@_attrs_define
class PatchApiGatewayV1CacheRulesByIdBodyMatchers:
    """
    Attributes:
        vk_id (str | Unset):
        vk_tags (list[str] | Unset):
        vk_prefix (str | Unset):
        principal_id (str | Unset):
        model (str | Unset):
        request_metadata (PatchApiGatewayV1CacheRulesByIdBodyMatchersRequestMetadata | Unset):
    """

    vk_id: str | Unset = UNSET
    vk_tags: list[str] | Unset = UNSET
    vk_prefix: str | Unset = UNSET
    principal_id: str | Unset = UNSET
    model: str | Unset = UNSET
    request_metadata: PatchApiGatewayV1CacheRulesByIdBodyMatchersRequestMetadata | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        vk_id = self.vk_id

        vk_tags: list[str] | Unset = UNSET
        if not isinstance(self.vk_tags, Unset):
            vk_tags = self.vk_tags

        vk_prefix = self.vk_prefix

        principal_id = self.principal_id

        model = self.model

        request_metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.request_metadata, Unset):
            request_metadata = self.request_metadata.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if vk_id is not UNSET:
            field_dict["vk_id"] = vk_id
        if vk_tags is not UNSET:
            field_dict["vk_tags"] = vk_tags
        if vk_prefix is not UNSET:
            field_dict["vk_prefix"] = vk_prefix
        if principal_id is not UNSET:
            field_dict["principal_id"] = principal_id
        if model is not UNSET:
            field_dict["model"] = model
        if request_metadata is not UNSET:
            field_dict["request_metadata"] = request_metadata

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.patch_api_gateway_v1_cache_rules_by_id_body_matchers_request_metadata import (
            PatchApiGatewayV1CacheRulesByIdBodyMatchersRequestMetadata,
        )

        d = dict(src_dict)
        vk_id = d.pop("vk_id", UNSET)

        vk_tags = cast(list[str], d.pop("vk_tags", UNSET))

        vk_prefix = d.pop("vk_prefix", UNSET)

        principal_id = d.pop("principal_id", UNSET)

        model = d.pop("model", UNSET)

        _request_metadata = d.pop("request_metadata", UNSET)
        request_metadata: PatchApiGatewayV1CacheRulesByIdBodyMatchersRequestMetadata | Unset
        if isinstance(_request_metadata, Unset):
            request_metadata = UNSET
        else:
            request_metadata = PatchApiGatewayV1CacheRulesByIdBodyMatchersRequestMetadata.from_dict(_request_metadata)

        patch_api_gateway_v1_cache_rules_by_id_body_matchers = cls(
            vk_id=vk_id,
            vk_tags=vk_tags,
            vk_prefix=vk_prefix,
            principal_id=principal_id,
            model=model,
            request_metadata=request_metadata,
        )

        return patch_api_gateway_v1_cache_rules_by_id_body_matchers
