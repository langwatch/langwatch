from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_gateway_v1_budgets_response_409_error_fault import PostApiGatewayV1BudgetsResponse409ErrorFault
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_gateway_v1_budgets_response_409_error_meta import PostApiGatewayV1BudgetsResponse409ErrorMeta


T = TypeVar("T", bound="PostApiGatewayV1BudgetsResponse409Error")


@_attrs_define
class PostApiGatewayV1BudgetsResponse409Error:
    """
    Attributes:
        type_ (str):
        code (str):
        message (str):
        retryable (bool):
        meta (PostApiGatewayV1BudgetsResponse409ErrorMeta | Unset):
        trace_id (str | Unset):
        span_id (str | Unset):
        tips (list[str] | Unset):
        docs_url (str | Unset):
        fault (PostApiGatewayV1BudgetsResponse409ErrorFault | Unset):
        reasons (list[Any] | Unset):
    """

    type_: str
    code: str
    message: str
    retryable: bool
    meta: PostApiGatewayV1BudgetsResponse409ErrorMeta | Unset = UNSET
    trace_id: str | Unset = UNSET
    span_id: str | Unset = UNSET
    tips: list[str] | Unset = UNSET
    docs_url: str | Unset = UNSET
    fault: PostApiGatewayV1BudgetsResponse409ErrorFault | Unset = UNSET
    reasons: list[Any] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        code = self.code

        message = self.message

        retryable = self.retryable

        meta: dict[str, Any] | Unset = UNSET
        if not isinstance(self.meta, Unset):
            meta = self.meta.to_dict()

        trace_id = self.trace_id

        span_id = self.span_id

        tips: list[str] | Unset = UNSET
        if not isinstance(self.tips, Unset):
            tips = self.tips

        docs_url = self.docs_url

        fault: str | Unset = UNSET
        if not isinstance(self.fault, Unset):
            fault = self.fault.value

        reasons: list[Any] | Unset = UNSET
        if not isinstance(self.reasons, Unset):
            reasons = self.reasons

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "code": code,
                "message": message,
                "retryable": retryable,
            }
        )
        if meta is not UNSET:
            field_dict["meta"] = meta
        if trace_id is not UNSET:
            field_dict["trace_id"] = trace_id
        if span_id is not UNSET:
            field_dict["span_id"] = span_id
        if tips is not UNSET:
            field_dict["tips"] = tips
        if docs_url is not UNSET:
            field_dict["docs_url"] = docs_url
        if fault is not UNSET:
            field_dict["fault"] = fault
        if reasons is not UNSET:
            field_dict["reasons"] = reasons

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_gateway_v1_budgets_response_409_error_meta import (
            PostApiGatewayV1BudgetsResponse409ErrorMeta,
        )

        d = dict(src_dict)
        type_ = d.pop("type")

        code = d.pop("code")

        message = d.pop("message")

        retryable = d.pop("retryable")

        _meta = d.pop("meta", UNSET)
        meta: PostApiGatewayV1BudgetsResponse409ErrorMeta | Unset
        if isinstance(_meta, Unset):
            meta = UNSET
        else:
            meta = PostApiGatewayV1BudgetsResponse409ErrorMeta.from_dict(_meta)

        trace_id = d.pop("trace_id", UNSET)

        span_id = d.pop("span_id", UNSET)

        tips = cast(list[str], d.pop("tips", UNSET))

        docs_url = d.pop("docs_url", UNSET)

        _fault = d.pop("fault", UNSET)
        fault: PostApiGatewayV1BudgetsResponse409ErrorFault | Unset
        if isinstance(_fault, Unset):
            fault = UNSET
        else:
            fault = PostApiGatewayV1BudgetsResponse409ErrorFault(_fault)

        reasons = cast(list[Any], d.pop("reasons", UNSET))

        post_api_gateway_v1_budgets_response_409_error = cls(
            type_=type_,
            code=code,
            message=message,
            retryable=retryable,
            meta=meta,
            trace_id=trace_id,
            span_id=span_id,
            tips=tips,
            docs_url=docs_url,
            fault=fault,
            reasons=reasons,
        )

        post_api_gateway_v1_budgets_response_409_error.additional_properties = d
        return post_api_gateway_v1_budgets_response_409_error

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
