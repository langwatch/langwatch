from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="DeleteApiWorkflowsByIdResponse200")


@_attrs_define
class DeleteApiWorkflowsByIdResponse200:
    """
    Attributes:
        id (str):
        archived (bool):
    """

    id: str
    archived: bool

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        archived = self.archived

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "archived": archived,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        archived = d.pop("archived")

        delete_api_workflows_by_id_response_200 = cls(
            id=id,
            archived=archived,
        )

        return delete_api_workflows_by_id_response_200
