from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="AssignAgentLabelResponse200")


@_attrs_define
class AssignAgentLabelResponse200:
    """
    Attributes:
        label (str):
        version (int):
        version_id (str):
    """

    label: str
    version: int
    version_id: str

    def to_dict(self) -> dict[str, Any]:
        label = self.label

        version = self.version

        version_id = self.version_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "label": label,
                "version": version,
                "versionId": version_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        label = d.pop("label")

        version = d.pop("version")

        version_id = d.pop("versionId")

        assign_agent_label_response_200 = cls(
            label=label,
            version=version,
            version_id=version_id,
        )

        return assign_agent_label_response_200
