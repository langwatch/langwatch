from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ArchiveRunPlanResponse200")


@_attrs_define
class ArchiveRunPlanResponse200:
    """
    Attributes:
        id (str): The run plan that was archived.
        archived (bool): Always true once the plan is archived.
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

        archive_run_plan_response_200 = cls(
            id=id,
            archived=archived,
        )

        return archive_run_plan_response_200
