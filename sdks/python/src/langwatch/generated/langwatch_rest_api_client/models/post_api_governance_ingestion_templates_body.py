from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_governance_ingestion_templates_body_credential_schema_type_0 import (
    PostApiGovernanceIngestionTemplatesBodyCredentialSchemaType0,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiGovernanceIngestionTemplatesBody")


@_attrs_define
class PostApiGovernanceIngestionTemplatesBody:
    """
    Attributes:
        source_type (str):
        display_name (str):
        description (str | Unset):
        icon_asset (str | Unset):
        credential_schema (None | PostApiGovernanceIngestionTemplatesBodyCredentialSchemaType0 | Unset):
        ottl_rules (str | Unset):
    """

    source_type: str
    display_name: str
    description: str | Unset = UNSET
    icon_asset: str | Unset = UNSET
    credential_schema: None | PostApiGovernanceIngestionTemplatesBodyCredentialSchemaType0 | Unset = UNSET
    ottl_rules: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        source_type = self.source_type

        display_name = self.display_name

        description = self.description

        icon_asset = self.icon_asset

        credential_schema: None | str | Unset
        if isinstance(self.credential_schema, Unset):
            credential_schema = UNSET
        elif isinstance(self.credential_schema, PostApiGovernanceIngestionTemplatesBodyCredentialSchemaType0):
            credential_schema = self.credential_schema.value
        else:
            credential_schema = self.credential_schema

        ottl_rules = self.ottl_rules

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "source_type": source_type,
                "display_name": display_name,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if icon_asset is not UNSET:
            field_dict["icon_asset"] = icon_asset
        if credential_schema is not UNSET:
            field_dict["credential_schema"] = credential_schema
        if ottl_rules is not UNSET:
            field_dict["ottl_rules"] = ottl_rules

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        source_type = d.pop("source_type")

        display_name = d.pop("display_name")

        description = d.pop("description", UNSET)

        icon_asset = d.pop("icon_asset", UNSET)

        def _parse_credential_schema(
            data: object,
        ) -> None | PostApiGovernanceIngestionTemplatesBodyCredentialSchemaType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                credential_schema_type_0 = PostApiGovernanceIngestionTemplatesBodyCredentialSchemaType0(data)

                return credential_schema_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PostApiGovernanceIngestionTemplatesBodyCredentialSchemaType0 | Unset, data)

        credential_schema = _parse_credential_schema(d.pop("credential_schema", UNSET))

        ottl_rules = d.pop("ottl_rules", UNSET)

        post_api_governance_ingestion_templates_body = cls(
            source_type=source_type,
            display_name=display_name,
            description=description,
            icon_asset=icon_asset,
            credential_schema=credential_schema,
            ottl_rules=ottl_rules,
        )

        post_api_governance_ingestion_templates_body.additional_properties = d
        return post_api_governance_ingestion_templates_body

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
