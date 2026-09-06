from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiExperimentsRunsByRunIdResultsResponse200Timestamps")


@_attrs_define
class GetApiExperimentsRunsByRunIdResultsResponse200Timestamps:
    """
    Attributes:
        created_at (float):
        updated_at (float):
        finished_at (float | None | Unset):
        stopped_at (float | None | Unset):
    """

    created_at: float
    updated_at: float
    finished_at: float | None | Unset = UNSET
    stopped_at: float | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        created_at = self.created_at

        updated_at = self.updated_at

        finished_at: float | None | Unset
        if isinstance(self.finished_at, Unset):
            finished_at = UNSET
        else:
            finished_at = self.finished_at

        stopped_at: float | None | Unset
        if isinstance(self.stopped_at, Unset):
            stopped_at = UNSET
        else:
            stopped_at = self.stopped_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "createdAt": created_at,
                "updatedAt": updated_at,
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
        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        def _parse_finished_at(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        finished_at = _parse_finished_at(d.pop("finishedAt", UNSET))

        def _parse_stopped_at(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        stopped_at = _parse_stopped_at(d.pop("stoppedAt", UNSET))

        get_api_experiments_runs_by_run_id_results_response_200_timestamps = cls(
            created_at=created_at,
            updated_at=updated_at,
            finished_at=finished_at,
            stopped_at=stopped_at,
        )

        get_api_experiments_runs_by_run_id_results_response_200_timestamps.additional_properties = d
        return get_api_experiments_runs_by_run_id_results_response_200_timestamps

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
