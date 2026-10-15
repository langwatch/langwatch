from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="RunAdminOperationResponse200")


@_attrs_define
class RunAdminOperationResponse200:
    """
    Attributes:
        data (Any):
        total (int | Unset):
    """

    data: Any
    total: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        data = self.data

        total = self.total

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "data": data,
            }
        )
        if total is not UNSET:
            field_dict["total"] = total

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        data = d.pop("data")

        total = d.pop("total", UNSET)

        run_admin_operation_response_200 = cls(
            data=data,
            total=total,
        )

        return run_admin_operation_response_200
