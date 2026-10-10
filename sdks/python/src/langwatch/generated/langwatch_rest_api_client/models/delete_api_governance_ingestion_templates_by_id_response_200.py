from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="DeleteApiGovernanceIngestionTemplatesByIdResponse200")


@_attrs_define
class DeleteApiGovernanceIngestionTemplatesByIdResponse200:
    """
    Attributes:
        archived (bool):
    """

    archived: bool

    def to_dict(self) -> dict[str, Any]:
        archived = self.archived

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "archived": archived,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        archived = d.pop("archived")

        delete_api_governance_ingestion_templates_by_id_response_200 = cls(
            archived=archived,
        )

        return delete_api_governance_ingestion_templates_by_id_response_200
