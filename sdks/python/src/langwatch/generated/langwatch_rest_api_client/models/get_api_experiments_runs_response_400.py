from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiExperimentsRunsResponse400")


@_attrs_define
class GetApiExperimentsRunsResponse400:
    """
    Attributes:
        error (str): What was wrong with the request, as a sentence
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

        get_api_experiments_runs_response_400 = cls(
            error=error,
        )

        return get_api_experiments_runs_response_400
