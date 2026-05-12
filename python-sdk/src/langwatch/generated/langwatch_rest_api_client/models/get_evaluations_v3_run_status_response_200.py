from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_evaluations_v3_run_status_response_200_status import GetEvaluationsV3RunStatusResponse200Status
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_evaluations_v3_run_status_response_200_summary import GetEvaluationsV3RunStatusResponse200Summary


T = TypeVar("T", bound="GetEvaluationsV3RunStatusResponse200")


@_attrs_define
class GetEvaluationsV3RunStatusResponse200:
    """
    Attributes:
        run_id (str):
        status (GetEvaluationsV3RunStatusResponse200Status):
        progress (int): Number of cells completed
        total (int): Total number of cells
        started_at (int | Unset): Unix timestamp when run started
        finished_at (int | Unset): Unix timestamp when run finished (only present when completed/failed/stopped)
        summary (GetEvaluationsV3RunStatusResponse200Summary | Unset): Execution summary (only present when completed)
        error (str | Unset): Error message (only present when failed)
    """

    run_id: str
    status: GetEvaluationsV3RunStatusResponse200Status
    progress: int
    total: int
    started_at: int | Unset = UNSET
    finished_at: int | Unset = UNSET
    summary: GetEvaluationsV3RunStatusResponse200Summary | Unset = UNSET
    error: str | Unset = UNSET
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

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_evaluations_v3_run_status_response_200_summary import (
            GetEvaluationsV3RunStatusResponse200Summary,
        )

        d = dict(src_dict)
        run_id = d.pop("runId")

        status = GetEvaluationsV3RunStatusResponse200Status(d.pop("status"))

        progress = d.pop("progress")

        total = d.pop("total")

        started_at = d.pop("startedAt", UNSET)

        finished_at = d.pop("finishedAt", UNSET)

        _summary = d.pop("summary", UNSET)
        summary: GetEvaluationsV3RunStatusResponse200Summary | Unset
        if isinstance(_summary, Unset):
            summary = UNSET
        else:
            summary = GetEvaluationsV3RunStatusResponse200Summary.from_dict(_summary)

        error = d.pop("error", UNSET)

        get_evaluations_v3_run_status_response_200 = cls(
            run_id=run_id,
            status=status,
            progress=progress,
            total=total,
            started_at=started_at,
            finished_at=finished_at,
            summary=summary,
            error=error,
        )

        get_evaluations_v3_run_status_response_200.additional_properties = d
        return get_evaluations_v3_run_status_response_200

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
