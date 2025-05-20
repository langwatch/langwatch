from collections.abc import Mapping
from typing import Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiTraceIdResponse200ErrorType0")


@_attrs_define
class GetApiTraceIdResponse200ErrorType0:
    """
    Attributes:
        stacktrace (Union[Unset, list[str]]):
        message (Union[Unset, str]):
        has_error (Union[Unset, bool]):
    """

    stacktrace: Union[Unset, list[str]] = UNSET
    message: Union[Unset, str] = UNSET
    has_error: Union[Unset, bool] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        stacktrace: Union[Unset, list[str]] = UNSET
        if not isinstance(self.stacktrace, Unset):
            stacktrace = self.stacktrace

        message = self.message

        has_error = self.has_error

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if stacktrace is not UNSET:
            field_dict["stacktrace"] = stacktrace
        if message is not UNSET:
            field_dict["message"] = message
        if has_error is not UNSET:
            field_dict["has_error"] = has_error

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        stacktrace = cast(list[str], d.pop("stacktrace", UNSET))

        message = d.pop("message", UNSET)

        has_error = d.pop("has_error", UNSET)

        get_api_trace_id_response_200_error_type_0 = cls(
            stacktrace=stacktrace,
            message=message,
            has_error=has_error,
        )

        get_api_trace_id_response_200_error_type_0.additional_properties = d
        return get_api_trace_id_response_200_error_type_0

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
