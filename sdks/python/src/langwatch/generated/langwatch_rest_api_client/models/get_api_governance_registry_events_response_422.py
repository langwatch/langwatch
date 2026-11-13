from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_governance_registry_events_response_422_fault import (
    GetApiGovernanceRegistryEventsResponse422Fault,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_governance_registry_events_response_422_meta import (
        GetApiGovernanceRegistryEventsResponse422Meta,
    )
    from ..models.get_api_governance_registry_events_response_422_trace import (
        GetApiGovernanceRegistryEventsResponse422Trace,
    )


T = TypeVar("T", bound="GetApiGovernanceRegistryEventsResponse422")


@_attrs_define
class GetApiGovernanceRegistryEventsResponse422:
    """
    Attributes:
        type_ (str):
        code (str):
        message (str):
        retryable (bool):
        meta (GetApiGovernanceRegistryEventsResponse422Meta | Unset):
        trace_id (str | Unset):
        span_id (str | Unset):
        trace (GetApiGovernanceRegistryEventsResponse422Trace | Unset):
        tips (list[str] | Unset):
        docs_url (str | Unset):
        fault (GetApiGovernanceRegistryEventsResponse422Fault | Unset):
        reasons (list[Any] | Unset):
    """

    type_: str
    code: str
    message: str
    retryable: bool
    meta: GetApiGovernanceRegistryEventsResponse422Meta | Unset = UNSET
    trace_id: str | Unset = UNSET
    span_id: str | Unset = UNSET
    trace: GetApiGovernanceRegistryEventsResponse422Trace | Unset = UNSET
    tips: list[str] | Unset = UNSET
    docs_url: str | Unset = UNSET
    fault: GetApiGovernanceRegistryEventsResponse422Fault | Unset = UNSET
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

        trace: dict[str, Any] | Unset = UNSET
        if not isinstance(self.trace, Unset):
            trace = self.trace.to_dict()

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
        if trace is not UNSET:
            field_dict["trace"] = trace
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
        from ..models.get_api_governance_registry_events_response_422_meta import (
            GetApiGovernanceRegistryEventsResponse422Meta,
        )
        from ..models.get_api_governance_registry_events_response_422_trace import (
            GetApiGovernanceRegistryEventsResponse422Trace,
        )

        d = dict(src_dict)
        type_ = d.pop("type")

        code = d.pop("code")

        message = d.pop("message")

        retryable = d.pop("retryable")

        _meta = d.pop("meta", UNSET)
        meta: GetApiGovernanceRegistryEventsResponse422Meta | Unset
        if isinstance(_meta, Unset):
            meta = UNSET
        else:
            meta = GetApiGovernanceRegistryEventsResponse422Meta.from_dict(_meta)

        trace_id = d.pop("trace_id", UNSET)

        span_id = d.pop("span_id", UNSET)

        _trace = d.pop("trace", UNSET)
        trace: GetApiGovernanceRegistryEventsResponse422Trace | Unset
        if isinstance(_trace, Unset):
            trace = UNSET
        else:
            trace = GetApiGovernanceRegistryEventsResponse422Trace.from_dict(_trace)

        tips = cast(list[str], d.pop("tips", UNSET))

        docs_url = d.pop("docs_url", UNSET)

        _fault = d.pop("fault", UNSET)
        fault: GetApiGovernanceRegistryEventsResponse422Fault | Unset
        if isinstance(_fault, Unset):
            fault = UNSET
        else:
            fault = GetApiGovernanceRegistryEventsResponse422Fault(_fault)

        reasons = cast(list[Any], d.pop("reasons", UNSET))

        get_api_governance_registry_events_response_422 = cls(
            type_=type_,
            code=code,
            message=message,
            retryable=retryable,
            meta=meta,
            trace_id=trace_id,
            span_id=span_id,
            trace=trace,
            tips=tips,
            docs_url=docs_url,
            fault=fault,
            reasons=reasons,
        )

        get_api_governance_registry_events_response_422.additional_properties = d
        return get_api_governance_registry_events_response_422

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
