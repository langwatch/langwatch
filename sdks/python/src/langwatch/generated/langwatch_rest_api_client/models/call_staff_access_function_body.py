from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="CallStaffAccessFunctionBody")


@_attrs_define
class CallStaffAccessFunctionBody:
    """
    Attributes:
        input_ (Any | Unset):
    """

    input_: Any | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        input_ = self.input_

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if input_ is not UNSET:
            field_dict["input"] = input_

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        input_ = d.pop("input", UNSET)

        call_staff_access_function_body = cls(
            input_=input_,
        )

        return call_staff_access_function_body
