from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.read_cli_project_key_response_200_project import ReadCliProjectKeyResponse200Project


T = TypeVar("T", bound="ReadCliProjectKeyResponse200")


@_attrs_define
class ReadCliProjectKeyResponse200:
    """
    Attributes:
        project (ReadCliProjectKeyResponse200Project):
    """

    project: ReadCliProjectKeyResponse200Project

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
        from ..models.read_cli_project_key_response_200_project import ReadCliProjectKeyResponse200Project

        d = dict(src_dict)
        project = ReadCliProjectKeyResponse200Project.from_dict(d.pop("project"))

        read_cli_project_key_response_200 = cls(
            project=project,
        )

        return read_cli_project_key_response_200
