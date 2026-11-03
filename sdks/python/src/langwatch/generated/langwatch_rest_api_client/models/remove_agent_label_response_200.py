from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="RemoveAgentLabelResponse200")


@_attrs_define
class RemoveAgentLabelResponse200:
    """
    Attributes:
        label (str):
        removed (bool):
    """

    label: str
    removed: bool

    def to_dict(self) -> dict[str, Any]:
        label = self.label

        removed = self.removed

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "label": label,
                "removed": removed,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        label = d.pop("label")

        removed = d.pop("removed")

        remove_agent_label_response_200 = cls(
            label=label,
            removed=removed,
        )

        return remove_agent_label_response_200
