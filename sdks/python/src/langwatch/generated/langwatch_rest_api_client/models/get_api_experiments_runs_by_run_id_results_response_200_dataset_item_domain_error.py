from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_experiments_runs_by_run_id_results_response_200_dataset_item_domain_error_meta import (
        GetApiExperimentsRunsByRunIdResultsResponse200DatasetItemDomainErrorMeta,
    )


T = TypeVar("T", bound="GetApiExperimentsRunsByRunIdResultsResponse200DatasetItemDomainError")


@_attrs_define
class GetApiExperimentsRunsByRunIdResultsResponse200DatasetItemDomainError:
    """Set on rows written since failures started carrying codes

    Attributes:
        code (str): Stable failure code; branch on this
        kind (str): Deprecated alias of code, for older clients
        message (str | Unset):
        meta (GetApiExperimentsRunsByRunIdResultsResponse200DatasetItemDomainErrorMeta | Unset):
        http_status (float | Unset):
        fault (str | Unset): Who the failure is attributable to: customer, platform, presumed_platform, provider
        trace_id (str | Unset):
        span_id (str | Unset):
        trace_url (str | Unset):
        retryable (bool | Unset):
        tips (list[str] | Unset):
        docs_url (str | Unset):
        reasons (list[Any] | Unset):
    """

    code: str
    kind: str
    message: str | Unset = UNSET
    meta: GetApiExperimentsRunsByRunIdResultsResponse200DatasetItemDomainErrorMeta | Unset = UNSET
    http_status: float | Unset = UNSET
    fault: str | Unset = UNSET
    trace_id: str | Unset = UNSET
    span_id: str | Unset = UNSET
    trace_url: str | Unset = UNSET
    retryable: bool | Unset = UNSET
    tips: list[str] | Unset = UNSET
    docs_url: str | Unset = UNSET
    reasons: list[Any] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        code = self.code

        kind = self.kind

        message = self.message

        meta: dict[str, Any] | Unset = UNSET
        if not isinstance(self.meta, Unset):
            meta = self.meta.to_dict()

        http_status = self.http_status

        fault = self.fault

        trace_id = self.trace_id

        span_id = self.span_id

        trace_url = self.trace_url

        retryable = self.retryable

        tips: list[str] | Unset = UNSET
        if not isinstance(self.tips, Unset):
            tips = self.tips

        docs_url = self.docs_url

        reasons: list[Any] | Unset = UNSET
        if not isinstance(self.reasons, Unset):
            reasons = self.reasons

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "code": code,
                "kind": kind,
            }
        )
        if message is not UNSET:
            field_dict["message"] = message
        if meta is not UNSET:
            field_dict["meta"] = meta
        if http_status is not UNSET:
            field_dict["httpStatus"] = http_status
        if fault is not UNSET:
            field_dict["fault"] = fault
        if trace_id is not UNSET:
            field_dict["traceId"] = trace_id
        if span_id is not UNSET:
            field_dict["spanId"] = span_id
        if trace_url is not UNSET:
            field_dict["traceUrl"] = trace_url
        if retryable is not UNSET:
            field_dict["retryable"] = retryable
        if tips is not UNSET:
            field_dict["tips"] = tips
        if docs_url is not UNSET:
            field_dict["docsUrl"] = docs_url
        if reasons is not UNSET:
            field_dict["reasons"] = reasons

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_experiments_runs_by_run_id_results_response_200_dataset_item_domain_error_meta import (
            GetApiExperimentsRunsByRunIdResultsResponse200DatasetItemDomainErrorMeta,
        )

        d = dict(src_dict)
        code = d.pop("code")

        kind = d.pop("kind")

        message = d.pop("message", UNSET)

        _meta = d.pop("meta", UNSET)
        meta: GetApiExperimentsRunsByRunIdResultsResponse200DatasetItemDomainErrorMeta | Unset
        if isinstance(_meta, Unset):
            meta = UNSET
        else:
            meta = GetApiExperimentsRunsByRunIdResultsResponse200DatasetItemDomainErrorMeta.from_dict(_meta)

        http_status = d.pop("httpStatus", UNSET)

        fault = d.pop("fault", UNSET)

        trace_id = d.pop("traceId", UNSET)

        span_id = d.pop("spanId", UNSET)

        trace_url = d.pop("traceUrl", UNSET)

        retryable = d.pop("retryable", UNSET)

        tips = cast(list[str], d.pop("tips", UNSET))

        docs_url = d.pop("docsUrl", UNSET)

        reasons = cast(list[Any], d.pop("reasons", UNSET))

        get_api_experiments_runs_by_run_id_results_response_200_dataset_item_domain_error = cls(
            code=code,
            kind=kind,
            message=message,
            meta=meta,
            http_status=http_status,
            fault=fault,
            trace_id=trace_id,
            span_id=span_id,
            trace_url=trace_url,
            retryable=retryable,
            tips=tips,
            docs_url=docs_url,
            reasons=reasons,
        )

        return get_api_experiments_runs_by_run_id_results_response_200_dataset_item_domain_error
