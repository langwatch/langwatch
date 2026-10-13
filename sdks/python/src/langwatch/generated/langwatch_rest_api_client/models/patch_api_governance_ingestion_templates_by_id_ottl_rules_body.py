from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PatchApiGovernanceIngestionTemplatesByIdOttlRulesBody")


@_attrs_define
class PatchApiGovernanceIngestionTemplatesByIdOttlRulesBody:
    """
    Attributes:
        ottl_rules (str):
    """

    ottl_rules: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        ottl_rules = self.ottl_rules

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "ottl_rules": ottl_rules,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        ottl_rules = d.pop("ottl_rules")

        patch_api_governance_ingestion_templates_by_id_ottl_rules_body = cls(
            ottl_rules=ottl_rules,
        )

        patch_api_governance_ingestion_templates_by_id_ottl_rules_body.additional_properties = d
        return patch_api_governance_ingestion_templates_by_id_ottl_rules_body

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
