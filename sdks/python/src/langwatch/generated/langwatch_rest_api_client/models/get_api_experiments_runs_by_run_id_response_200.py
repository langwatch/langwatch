from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_experiments_runs_by_run_id_response_200_status import (
    GetApiExperimentsRunsByRunIdResponse200Status,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_experiments_runs_by_run_id_response_200_domain_error import (
        GetApiExperimentsRunsByRunIdResponse200DomainError,
    )
    from ..models.get_api_experiments_runs_by_run_id_response_200_summary import (
        GetApiExperimentsRunsByRunIdResponse200Summary,
    )


T = TypeVar("T", bound="GetApiExperimentsRunsByRunIdResponse200")


@_attrs_define
class GetApiExperimentsRunsByRunIdResponse200:
    """
    Attributes:
        run_id (str):
        status (GetApiExperimentsRunsByRunIdResponse200Status):
        progress (float): Cells finished so far
        total (float): Cells in the run
        started_at (float | Unset): Unix milliseconds
        finished_at (float | Unset): Unix milliseconds; set once the run is no longer running
        summary (GetApiExperimentsRunsByRunIdResponse200Summary | Unset): Present when completed
        error (str | Unset): Stable failure code, present when failed. Not display copy: render your own wording keyed
            on it.
        domain_error (GetApiExperimentsRunsByRunIdResponse200DomainError | Unset): The full failure envelope, when the
            failure carried one
        trace_id (str | Unset): Trace id for failures that carry no code, to quote in support
    """

    run_id: str
    status: GetApiExperimentsRunsByRunIdResponse200Status
    progress: float
    total: float
    started_at: float | Unset = UNSET
    finished_at: float | Unset = UNSET
    summary: GetApiExperimentsRunsByRunIdResponse200Summary | Unset = UNSET
    error: str | Unset = UNSET
    domain_error: GetApiExperimentsRunsByRunIdResponse200DomainError | Unset = UNSET
    trace_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        run_id = self.run_id

        status = self.status.value

        progress = self.progress

        total = self.total

        started_at = self.started_at

        finished_at = self.finished_at

        summary: dict[str, Any] | Unset = UNSET
        if not isinstance(self.summary, Unset):
            summary = self.summary.to_dict()

        error = self.error

        domain_error: dict[str, Any] | Unset = UNSET
        if not isinstance(self.domain_error, Unset):
            domain_error = self.domain_error.to_dict()

        trace_id = self.trace_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "runId": run_id,
                "status": status,
                "progress": progress,
                "total": total,
            }
        )
        if started_at is not UNSET:
            field_dict["startedAt"] = started_at
        if finished_at is not UNSET:
            field_dict["finishedAt"] = finished_at
        if summary is not UNSET:
            field_dict["summary"] = summary
        if error is not UNSET:
            field_dict["error"] = error
        if domain_error is not UNSET:
            field_dict["domainError"] = domain_error
        if trace_id is not UNSET:
            field_dict["traceId"] = trace_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_experiments_runs_by_run_id_response_200_domain_error import (
            GetApiExperimentsRunsByRunIdResponse200DomainError,
        )
        from ..models.get_api_experiments_runs_by_run_id_response_200_summary import (
            GetApiExperimentsRunsByRunIdResponse200Summary,
        )

        d = dict(src_dict)
        run_id = d.pop("runId")

        status = GetApiExperimentsRunsByRunIdResponse200Status(d.pop("status"))

        progress = d.pop("progress")

        total = d.pop("total")

        started_at = d.pop("startedAt", UNSET)

        finished_at = d.pop("finishedAt", UNSET)

        _summary = d.pop("summary", UNSET)
        summary: GetApiExperimentsRunsByRunIdResponse200Summary | Unset
        if isinstance(_summary, Unset):
            summary = UNSET
        else:
            summary = GetApiExperimentsRunsByRunIdResponse200Summary.from_dict(_summary)

        error = d.pop("error", UNSET)

        _domain_error = d.pop("domainError", UNSET)
        domain_error: GetApiExperimentsRunsByRunIdResponse200DomainError | Unset
        if isinstance(_domain_error, Unset):
            domain_error = UNSET
        else:
            domain_error = GetApiExperimentsRunsByRunIdResponse200DomainError.from_dict(_domain_error)

        trace_id = d.pop("traceId", UNSET)

        get_api_experiments_runs_by_run_id_response_200 = cls(
            run_id=run_id,
            status=status,
            progress=progress,
            total=total,
            started_at=started_at,
            finished_at=finished_at,
            summary=summary,
            error=error,
            domain_error=domain_error,
            trace_id=trace_id,
        )

        get_api_experiments_runs_by_run_id_response_200.additional_properties = d
        return get_api_experiments_runs_by_run_id_response_200

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
