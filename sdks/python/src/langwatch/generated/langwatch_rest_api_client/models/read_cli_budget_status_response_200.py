from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ReadCliBudgetStatusResponse200")


@_attrs_define
class ReadCliBudgetStatusResponse200:
    """
    Attributes:
        ok (bool):
    """

    ok: bool

    def to_dict(self) -> dict[str, Any]:
        ok = self.ok

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "ok": ok,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        ok = d.pop("ok")

        read_cli_budget_status_response_200 = cls(
            ok=ok,
        )

        return read_cli_budget_status_response_200
