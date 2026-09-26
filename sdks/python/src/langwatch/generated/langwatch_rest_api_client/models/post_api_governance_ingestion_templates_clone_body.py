from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiGovernanceIngestionTemplatesCloneBody")


@_attrs_define
class PostApiGovernanceIngestionTemplatesCloneBody:
    """
    Attributes:
        source_template_id (str):
    """

    source_template_id: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        source_template_id = self.source_template_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "source_template_id": source_template_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        source_template_id = d.pop("source_template_id")

        post_api_governance_ingestion_templates_clone_body = cls(
            source_template_id=source_template_id,
        )

        post_api_governance_ingestion_templates_clone_body.additional_properties = d
        return post_api_governance_ingestion_templates_clone_body

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
