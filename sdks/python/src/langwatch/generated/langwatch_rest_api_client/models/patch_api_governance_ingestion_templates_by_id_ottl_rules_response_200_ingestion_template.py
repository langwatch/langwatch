from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse200IngestionTemplate")


@_attrs_define
class PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse200IngestionTemplate:
    """
    Attributes:
        id (str):
        slug (str):
        source_type (str):
        display_name (str):
        description (None | str):
        icon_asset (None | str):
        credential_schema (None | str):
        ottl_rules (str):
        platform_published (bool):
        enabled (bool):
        organization_id (None | str):
    """

    id: str
    slug: str
    source_type: str
    display_name: str
    description: None | str
    icon_asset: None | str
    credential_schema: None | str
    ottl_rules: str
    platform_published: bool
    enabled: bool
    organization_id: None | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        slug = self.slug

        source_type = self.source_type

        display_name = self.display_name

        description: None | str
        description = self.description

        icon_asset: None | str
        icon_asset = self.icon_asset

        credential_schema: None | str
        credential_schema = self.credential_schema

        ottl_rules = self.ottl_rules

        platform_published = self.platform_published

        enabled = self.enabled

        organization_id: None | str
        organization_id = self.organization_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "slug": slug,
                "source_type": source_type,
                "display_name": display_name,
                "description": description,
                "icon_asset": icon_asset,
                "credential_schema": credential_schema,
                "ottl_rules": ottl_rules,
                "platform_published": platform_published,
                "enabled": enabled,
                "organization_id": organization_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        slug = d.pop("slug")

        source_type = d.pop("source_type")

        display_name = d.pop("display_name")

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))

        def _parse_icon_asset(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        icon_asset = _parse_icon_asset(d.pop("icon_asset"))

        def _parse_credential_schema(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        credential_schema = _parse_credential_schema(d.pop("credential_schema"))

        ottl_rules = d.pop("ottl_rules")

        platform_published = d.pop("platform_published")

        enabled = d.pop("enabled")

        def _parse_organization_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        organization_id = _parse_organization_id(d.pop("organization_id"))

        patch_api_governance_ingestion_templates_by_id_ottl_rules_response_200_ingestion_template = cls(
            id=id,
            slug=slug,
            source_type=source_type,
            display_name=display_name,
            description=description,
            icon_asset=icon_asset,
            credential_schema=credential_schema,
            ottl_rules=ottl_rules,
            platform_published=platform_published,
            enabled=enabled,
            organization_id=organization_id,
        )

        patch_api_governance_ingestion_templates_by_id_ottl_rules_response_200_ingestion_template.additional_properties = d
        return patch_api_governance_ingestion_templates_by_id_ottl_rules_response_200_ingestion_template

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
