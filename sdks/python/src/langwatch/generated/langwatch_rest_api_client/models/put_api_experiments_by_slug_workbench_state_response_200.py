from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PutApiExperimentsBySlugWorkbenchStateResponse200")


@_attrs_define
class PutApiExperimentsBySlugWorkbenchStateResponse200:
    """
    Attributes:
        version (int): The version the save produced
    """

    version: int

    def to_dict(self) -> dict[str, Any]:
        version = self.version

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "version": version,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        version = d.pop("version")

        put_api_experiments_by_slug_workbench_state_response_200 = cls(
            version=version,
        )

        return put_api_experiments_by_slug_workbench_state_response_200
