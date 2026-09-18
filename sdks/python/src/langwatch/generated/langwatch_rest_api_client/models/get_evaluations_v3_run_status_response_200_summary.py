from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetEvaluationsV3RunStatusResponse200Summary")


@_attrs_define
class GetEvaluationsV3RunStatusResponse200Summary:
    """Execution summary (only present when completed)

    Attributes:
        run_id (str | Unset):
        total_cells (int | Unset):
        completed_cells (int | Unset):
        failed_cells (int | Unset):
        duration (int | Unset): Total execution time in milliseconds
        run_url (str | Unset): URL to view the run in LangWatch
    """

    run_id: str | Unset = UNSET
    total_cells: int | Unset = UNSET
    completed_cells: int | Unset = UNSET
    failed_cells: int | Unset = UNSET
    duration: int | Unset = UNSET
    run_url: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        run_id = self.run_id

        total_cells = self.total_cells

        completed_cells = self.completed_cells

        failed_cells = self.failed_cells

        duration = self.duration

        run_url = self.run_url

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if run_id is not UNSET:
            field_dict["runId"] = run_id
        if total_cells is not UNSET:
            field_dict["totalCells"] = total_cells
        if completed_cells is not UNSET:
            field_dict["completedCells"] = completed_cells
        if failed_cells is not UNSET:
            field_dict["failedCells"] = failed_cells
        if duration is not UNSET:
            field_dict["duration"] = duration
        if run_url is not UNSET:
            field_dict["runUrl"] = run_url

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        run_id = d.pop("runId", UNSET)

        total_cells = d.pop("totalCells", UNSET)

        completed_cells = d.pop("completedCells", UNSET)

        failed_cells = d.pop("failedCells", UNSET)

        duration = d.pop("duration", UNSET)

        run_url = d.pop("runUrl", UNSET)

        get_evaluations_v3_run_status_response_200_summary = cls(
            run_id=run_id,
            total_cells=total_cells,
            completed_cells=completed_cells,
            failed_cells=failed_cells,
            duration=duration,
            run_url=run_url,
        )

        get_evaluations_v3_run_status_response_200_summary.additional_properties = d
        return get_evaluations_v3_run_status_response_200_summary

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
