from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiExperimentsRunsByRunIdResponse200SummaryTimestamps")


@_attrs_define
class GetApiExperimentsRunsByRunIdResponse200SummaryTimestamps:
    """
    Attributes:
        started_at (float):
        finished_at (float | Unset):
        stopped_at (float | Unset):
    """

    started_at: float
    finished_at: float | Unset = UNSET
    stopped_at: float | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        started_at = self.started_at

        finished_at = self.finished_at

        stopped_at = self.stopped_at

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "startedAt": started_at,
            }
        )
        if finished_at is not UNSET:
            field_dict["finishedAt"] = finished_at
        if stopped_at is not UNSET:
            field_dict["stoppedAt"] = stopped_at

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        started_at = d.pop("startedAt")

        finished_at = d.pop("finishedAt", UNSET)

        stopped_at = d.pop("stoppedAt", UNSET)

        get_api_experiments_runs_by_run_id_response_200_summary_timestamps = cls(
            started_at=started_at,
            finished_at=finished_at,
            stopped_at=stopped_at,
        )

        return get_api_experiments_runs_by_run_id_response_200_summary_timestamps
