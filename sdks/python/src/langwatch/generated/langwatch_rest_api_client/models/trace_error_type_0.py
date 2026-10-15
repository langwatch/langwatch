from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="TraceErrorType0")


@_attrs_define
class TraceErrorType0:
    """
    Attributes:
        has_error (bool):
        message (str):
        stacktrace (list[str]):
    """

    has_error: bool
    message: str
    stacktrace: list[str]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        has_error = self.has_error

        message = self.message

        stacktrace = self.stacktrace

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "has_error": has_error,
                "message": message,
                "stacktrace": stacktrace,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        has_error = d.pop("has_error")

        message = d.pop("message")

        stacktrace = cast(list[str], d.pop("stacktrace"))

        trace_error_type_0 = cls(
            has_error=has_error,
            message=message,
            stacktrace=stacktrace,
        )

        trace_error_type_0.additional_properties = d
        return trace_error_type_0

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
