from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiScenariosByIdVersionsResponse404")


@_attrs_define
class GetApiScenariosByIdVersionsResponse404:
    """
    Attributes:
        error (str):
    """

    error: str

    def to_dict(self) -> dict[str, Any]:
        error = self.error

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "error": error,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        error = d.pop("error")

        get_api_scenarios_by_id_versions_response_404 = cls(
            error=error,
        )

        return get_api_scenarios_by_id_versions_response_404
