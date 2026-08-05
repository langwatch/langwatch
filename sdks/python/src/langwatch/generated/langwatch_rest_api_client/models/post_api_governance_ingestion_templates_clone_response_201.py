from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        ingestion_template = self.ingestion_template.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        post_api_governance_ingestion_templates_clone_response_201.additional_properties = d
        return post_api_governance_ingestion_templates_clone_response_201

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
