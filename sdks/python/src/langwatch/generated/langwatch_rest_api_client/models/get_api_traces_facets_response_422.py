from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_traces_facets_response_422_reasons_item import GetApiTracesFacetsResponse422ReasonsItem


T = TypeVar("T", bound="GetApiTracesFacetsResponse422")


@_attrs_define
class GetApiTracesFacetsResponse422:
    """
    Attributes:
        error (Literal['validation_error']):
        message (str):
        target (Literal['query']):
        fields (list[str]):
        reasons (list[GetApiTracesFacetsResponse422ReasonsItem]):
        trace (str | Unset):
    """

    error: Literal["validation_error"]
    message: str
    target: Literal["query"]
    fields: list[str]
    reasons: list[GetApiTracesFacetsResponse422ReasonsItem]
    trace: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        error = self.error

        message = self.message

        target = self.target

        fields = self.fields

        reasons = []
        for reasons_item_data in self.reasons:
            reasons_item = reasons_item_data.to_dict()
            reasons.append(reasons_item)

        trace = self.trace

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "error": error,
                "message": message,
                "target": target,
                "fields": fields,
                "reasons": reasons,
            }
        )
        if trace is not UNSET:
            field_dict["trace"] = trace

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_traces_facets_response_422_reasons_item import GetApiTracesFacetsResponse422ReasonsItem

        d = dict(src_dict)
        error = cast(Literal["validation_error"], d.pop("error"))
        if error != "validation_error":
            raise ValueError(f"error must match const 'validation_error', got '{error}'")

        message = d.pop("message")

        target = cast(Literal["query"], d.pop("target"))
        if target != "query":
            raise ValueError(f"target must match const 'query', got '{target}'")

        fields = cast(list[str], d.pop("fields"))

        reasons = []
        _reasons = d.pop("reasons")
        for reasons_item_data in _reasons:
            reasons_item = GetApiTracesFacetsResponse422ReasonsItem.from_dict(reasons_item_data)

            reasons.append(reasons_item)

        trace = d.pop("trace", UNSET)

        get_api_traces_facets_response_422 = cls(
            error=error,
            message=message,
            target=target,
            fields=fields,
            reasons=reasons,
            trace=trace,
        )

        get_api_traces_facets_response_422.additional_properties = d
        return get_api_traces_facets_response_422

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
