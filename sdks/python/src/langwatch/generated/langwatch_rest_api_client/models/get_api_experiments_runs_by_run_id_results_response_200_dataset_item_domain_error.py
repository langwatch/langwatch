from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
        fault (str | Unset): Who the failure is attributable to: customer, platform, provider
        trace_id (str | Unset):
        tips (list[str] | Unset):
        docs_url (str | Unset):
    """

    code: str
    kind: str
    message: str | Unset = UNSET
    meta: GetApiExperimentsRunsByRunIdResultsResponse200DatasetItemDomainErrorMeta | Unset = UNSET
    http_status: float | Unset = UNSET
    fault: str | Unset = UNSET
    trace_id: str | Unset = UNSET
    tips: list[str] | Unset = UNSET
    docs_url: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

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

        tips: list[str] | Unset = UNSET
        if not isinstance(self.tips, Unset):
            tips = self.tips

        docs_url = self.docs_url

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        if tips is not UNSET:
            field_dict["tips"] = tips
        if docs_url is not UNSET:
            field_dict["docsUrl"] = docs_url

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

        tips = cast(list[str], d.pop("tips", UNSET))

        docs_url = d.pop("docsUrl", UNSET)

        get_api_experiments_runs_by_run_id_results_response_200_dataset_item_domain_error = cls(
            code=code,
            kind=kind,
            message=message,
            meta=meta,
            http_status=http_status,
            fault=fault,
            trace_id=trace_id,
            tips=tips,
            docs_url=docs_url,
        )

        get_api_experiments_runs_by_run_id_results_response_200_dataset_item_domain_error.additional_properties = d
        return get_api_experiments_runs_by_run_id_results_response_200_dataset_item_domain_error

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
