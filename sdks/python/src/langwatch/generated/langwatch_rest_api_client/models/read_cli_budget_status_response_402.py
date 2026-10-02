from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.read_cli_budget_status_response_402_error import ReadCliBudgetStatusResponse402Error


T = TypeVar("T", bound="ReadCliBudgetStatusResponse402")


@_attrs_define
class ReadCliBudgetStatusResponse402:
    """
    Attributes:
        error (ReadCliBudgetStatusResponse402Error):
    """

    error: ReadCliBudgetStatusResponse402Error

    def to_dict(self) -> dict[str, Any]:
        error = self.error.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "error": error,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.read_cli_budget_status_response_402_error import ReadCliBudgetStatusResponse402Error

        d = dict(src_dict)
        error = ReadCliBudgetStatusResponse402Error.from_dict(d.pop("error"))

        read_cli_budget_status_response_402 = cls(
            error=error,
        )

        return read_cli_budget_status_response_402
