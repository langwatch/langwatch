from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="WithdrawStaffAccessRequestResponse200")


@_attrs_define
class WithdrawStaffAccessRequestResponse200:
    """
    Attributes:
        withdrawn (bool):
    """

    withdrawn: bool

    def to_dict(self) -> dict[str, Any]:
        withdrawn = self.withdrawn

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "withdrawn": withdrawn,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        withdrawn = d.pop("withdrawn")

        withdraw_staff_access_request_response_200 = cls(
            withdrawn=withdrawn,
        )

        return withdraw_staff_access_request_response_200
