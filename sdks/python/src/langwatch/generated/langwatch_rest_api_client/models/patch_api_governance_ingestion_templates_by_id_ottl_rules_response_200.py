from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.patch_api_governance_ingestion_templates_by_id_ottl_rules_response_200_ingestion_template import (
        PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse200IngestionTemplate,
    )


T = TypeVar("T", bound="PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse200")


@_attrs_define
class PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse200:
    """
    Attributes:
        ingestion_template (PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse200IngestionTemplate):
    """

    ingestion_template: PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse200IngestionTemplate

    def to_dict(self) -> dict[str, Any]:
        ingestion_template = self.ingestion_template.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "ingestion_template": ingestion_template,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.patch_api_governance_ingestion_templates_by_id_ottl_rules_response_200_ingestion_template import (
            PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse200IngestionTemplate,
        )

        d = dict(src_dict)
        ingestion_template = PatchApiGovernanceIngestionTemplatesByIdOttlRulesResponse200IngestionTemplate.from_dict(
            d.pop("ingestion_template")
        )

        patch_api_governance_ingestion_templates_by_id_ottl_rules_response_200 = cls(
            ingestion_template=ingestion_template,
        )

        return patch_api_governance_ingestion_templates_by_id_ottl_rules_response_200
