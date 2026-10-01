from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_governance_ingestion_templates_clone_response_201_ingestion_template import (
        PostApiGovernanceIngestionTemplatesCloneResponse201IngestionTemplate,
    )


T = TypeVar("T", bound="PostApiGovernanceIngestionTemplatesCloneResponse201")


@_attrs_define
class PostApiGovernanceIngestionTemplatesCloneResponse201:
    """
    Attributes:
        ingestion_template (PostApiGovernanceIngestionTemplatesCloneResponse201IngestionTemplate):
    """

    ingestion_template: PostApiGovernanceIngestionTemplatesCloneResponse201IngestionTemplate

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
        from ..models.post_api_governance_ingestion_templates_clone_response_201_ingestion_template import (
            PostApiGovernanceIngestionTemplatesCloneResponse201IngestionTemplate,
        )

        d = dict(src_dict)
        ingestion_template = PostApiGovernanceIngestionTemplatesCloneResponse201IngestionTemplate.from_dict(
            d.pop("ingestion_template")
        )

        post_api_governance_ingestion_templates_clone_response_201 = cls(
            ingestion_template=ingestion_template,
        )

        return post_api_governance_ingestion_templates_clone_response_201
