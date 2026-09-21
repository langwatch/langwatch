from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_gateway_v1_budgets_by_id_response_401_error_meta import (
        GetApiGatewayV1BudgetsByIdResponse401ErrorMeta,
    )


T = TypeVar("T", bound="GetApiGatewayV1BudgetsByIdResponse401Error")


@_attrs_define
class GetApiGatewayV1BudgetsByIdResponse401Error:
    """
    Attributes:
        type_ (str):
        code (str):
        message (str):
        meta (GetApiGatewayV1BudgetsByIdResponse401ErrorMeta | Unset):
        trace_id (str | Unset):
        span_id (str | Unset):
    """

    type_: str
    code: str
    message: str
    meta: GetApiGatewayV1BudgetsByIdResponse401ErrorMeta | Unset = UNSET
    trace_id: str | Unset = UNSET
    span_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        code = self.code

        message = self.message

        meta: dict[str, Any] | Unset = UNSET
        if not isinstance(self.meta, Unset):
            meta = self.meta.to_dict()

        trace_id = self.trace_id

        span_id = self.span_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "code": code,
                "message": message,
            }
        )
        if meta is not UNSET:
            field_dict["meta"] = meta
        if trace_id is not UNSET:
            field_dict["trace_id"] = trace_id
        if span_id is not UNSET:
            field_dict["span_id"] = span_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_gateway_v1_budgets_by_id_response_401_error_meta import (
            GetApiGatewayV1BudgetsByIdResponse401ErrorMeta,
        )

        d = dict(src_dict)
        type_ = d.pop("type")

        code = d.pop("code")

        message = d.pop("message")

        _meta = d.pop("meta", UNSET)
        meta: GetApiGatewayV1BudgetsByIdResponse401ErrorMeta | Unset
        if isinstance(_meta, Unset):
            meta = UNSET
        else:
            meta = GetApiGatewayV1BudgetsByIdResponse401ErrorMeta.from_dict(_meta)

        trace_id = d.pop("trace_id", UNSET)

        span_id = d.pop("span_id", UNSET)

        get_api_gateway_v1_budgets_by_id_response_401_error = cls(
            type_=type_,
            code=code,
            message=message,
            meta=meta,
            trace_id=trace_id,
            span_id=span_id,
        )

        get_api_gateway_v1_budgets_by_id_response_401_error.additional_properties = d
        return get_api_gateway_v1_budgets_by_id_response_401_error

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
