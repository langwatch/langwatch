from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiTracesFacetsResponse403")


@_attrs_define
class GetApiTracesFacetsResponse403:
    """
    Attributes:
        error (Literal['trace_attribute_values_withheld']):
        message (str):
        trace (str | Unset):
    """

    error: Literal["trace_attribute_values_withheld"]
    message: str
    trace: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        error = self.error

        message = self.message

        trace = self.trace

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "error": error,
                "message": message,
            }
        )
        if trace is not UNSET:
            field_dict["trace"] = trace

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        error = cast(Literal["trace_attribute_values_withheld"], d.pop("error"))
        if error != "trace_attribute_values_withheld":
            raise ValueError(f"error must match const 'trace_attribute_values_withheld', got '{error}'")

        message = d.pop("message")

        trace = d.pop("trace", UNSET)

        get_api_traces_facets_response_403 = cls(
            error=error,
            message=message,
            trace=trace,
        )

        get_api_traces_facets_response_403.additional_properties = d
        return get_api_traces_facets_response_403

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
