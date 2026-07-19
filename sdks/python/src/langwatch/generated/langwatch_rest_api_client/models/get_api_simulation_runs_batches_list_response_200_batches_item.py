from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetApiSimulationRunsBatchesListResponse200BatchesItem")


@_attrs_define
class GetApiSimulationRunsBatchesListResponse200BatchesItem:
    """
    Attributes:
        batch_run_id (str):
        total_count (float):
        pass_count (float):
        fail_count (float):
        running_count (float):
        stalled_count (float):
        last_run_at (float):
        last_updated_at (float):
        first_completed_at (float | None):
        all_completed_at (float | None):
    """

    batch_run_id: str
    total_count: float
    pass_count: float
    fail_count: float
    running_count: float
    stalled_count: float
    last_run_at: float
    last_updated_at: float
    first_completed_at: float | None
    all_completed_at: float | None
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        batch_run_id = self.batch_run_id

        total_count = self.total_count

        pass_count = self.pass_count

        fail_count = self.fail_count

        running_count = self.running_count

        stalled_count = self.stalled_count

        last_run_at = self.last_run_at

        last_updated_at = self.last_updated_at

        first_completed_at: float | None
        first_completed_at = self.first_completed_at

        all_completed_at: float | None
        all_completed_at = self.all_completed_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "batchRunId": batch_run_id,
                "totalCount": total_count,
                "passCount": pass_count,
                "failCount": fail_count,
                "runningCount": running_count,
                "stalledCount": stalled_count,
                "lastRunAt": last_run_at,
                "lastUpdatedAt": last_updated_at,
                "firstCompletedAt": first_completed_at,
                "allCompletedAt": all_completed_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        batch_run_id = d.pop("batchRunId")

        total_count = d.pop("totalCount")

        pass_count = d.pop("passCount")

        fail_count = d.pop("failCount")

        running_count = d.pop("runningCount")

        stalled_count = d.pop("stalledCount")

        last_run_at = d.pop("lastRunAt")

        last_updated_at = d.pop("lastUpdatedAt")

        def _parse_first_completed_at(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        first_completed_at = _parse_first_completed_at(d.pop("firstCompletedAt"))

        def _parse_all_completed_at(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        all_completed_at = _parse_all_completed_at(d.pop("allCompletedAt"))

        get_api_simulation_runs_batches_list_response_200_batches_item = cls(
            batch_run_id=batch_run_id,
            total_count=total_count,
            pass_count=pass_count,
            fail_count=fail_count,
            running_count=running_count,
            stalled_count=stalled_count,
            last_run_at=last_run_at,
            last_updated_at=last_updated_at,
            first_completed_at=first_completed_at,
            all_completed_at=all_completed_at,
        )

        get_api_simulation_runs_batches_list_response_200_batches_item.additional_properties = d
        return get_api_simulation_runs_batches_list_response_200_batches_item

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
