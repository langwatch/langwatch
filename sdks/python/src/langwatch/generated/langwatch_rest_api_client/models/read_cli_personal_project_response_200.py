from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.read_cli_personal_project_response_200_project import ReadCliPersonalProjectResponse200Project


T = TypeVar("T", bound="ReadCliPersonalProjectResponse200")


@_attrs_define
class ReadCliPersonalProjectResponse200:
    """
    Attributes:
        project (ReadCliPersonalProjectResponse200Project):
    """

    project: ReadCliPersonalProjectResponse200Project

    def to_dict(self) -> dict[str, Any]:
        project = self.project.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "project": project,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.read_cli_personal_project_response_200_project import ReadCliPersonalProjectResponse200Project

        d = dict(src_dict)
        project = ReadCliPersonalProjectResponse200Project.from_dict(d.pop("project"))

        read_cli_personal_project_response_200 = cls(
            project=project,
        )

        return read_cli_personal_project_response_200
