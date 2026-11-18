from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiTraceIdResponse200ExpectedOutput")


@_attrs_define
class GetApiTraceIdResponse200ExpectedOutput:
    """
    Attributes:
        value (str):
    """

    value: str

    def to_dict(self) -> dict[str, Any]:
        value = self.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "value": value,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        value = d.pop("value")

        get_api_trace_id_response_200_expected_output = cls(
            value=value,
        )

        return get_api_trace_id_response_200_expected_output
