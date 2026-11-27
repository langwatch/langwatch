from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="CallStaffAccessFunctionResponse200")


@_attrs_define
class CallStaffAccessFunctionResponse200:
    """
    Attributes:
        name (str):
        rows (int):
        output (Any):
    """

    name: str
    rows: int
    output: Any

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        rows = self.rows

        output = self.output

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "rows": rows,
                "output": output,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        rows = d.pop("rows")

        output = d.pop("output")

        call_staff_access_function_response_200 = cls(
            name=name,
            rows=rows,
            output=output,
        )

        return call_staff_access_function_response_200
