from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_governance_ingestion_templates_by_id_response_200_ingestion_template import (
        GetApiGovernanceIngestionTemplatesByIdResponse200IngestionTemplate,
    )


T = TypeVar("T", bound="GetApiGovernanceIngestionTemplatesByIdResponse200")


@_attrs_define
class GetApiGovernanceIngestionTemplatesByIdResponse200:
    """
    Attributes:
        ingestion_template (GetApiGovernanceIngestionTemplatesByIdResponse200IngestionTemplate):
    """

    ingestion_template: GetApiGovernanceIngestionTemplatesByIdResponse200IngestionTemplate

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
        from ..models.get_api_governance_ingestion_templates_by_id_response_200_ingestion_template import (
            GetApiGovernanceIngestionTemplatesByIdResponse200IngestionTemplate,
        )

        d = dict(src_dict)
        ingestion_template = GetApiGovernanceIngestionTemplatesByIdResponse200IngestionTemplate.from_dict(
            d.pop("ingestion_template")
        )

        get_api_governance_ingestion_templates_by_id_response_200 = cls(
            ingestion_template=ingestion_template,
        )

        return get_api_governance_ingestion_templates_by_id_response_200
