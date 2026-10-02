from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_simulation_runs_response_200_runs_item import GetApiSimulationRunsResponse200RunsItem


T = TypeVar("T", bound="GetApiSimulationRunsResponse200")


@_attrs_define
class GetApiSimulationRunsResponse200:
    """
    Attributes:
        runs (list[GetApiSimulationRunsResponse200RunsItem]):
        has_more (bool | Unset):
        next_cursor (str | Unset):
    """

    runs: list[GetApiSimulationRunsResponse200RunsItem]
    has_more: bool | Unset = UNSET
    next_cursor: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        runs = []
        for runs_item_data in self.runs:
            runs_item = runs_item_data.to_dict()
            runs.append(runs_item)

        has_more = self.has_more

        next_cursor = self.next_cursor

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "runs": runs,
            }
        )
        if has_more is not UNSET:
            field_dict["hasMore"] = has_more
        if next_cursor is not UNSET:
            field_dict["nextCursor"] = next_cursor

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_simulation_runs_response_200_runs_item import GetApiSimulationRunsResponse200RunsItem

        d = dict(src_dict)
        runs = []
        _runs = d.pop("runs")
        for runs_item_data in _runs:
            runs_item = GetApiSimulationRunsResponse200RunsItem.from_dict(runs_item_data)

            runs.append(runs_item)

        has_more = d.pop("hasMore", UNSET)

        next_cursor = d.pop("nextCursor", UNSET)

        get_api_simulation_runs_response_200 = cls(
            runs=runs,
            has_more=has_more,
            next_cursor=next_cursor,
        )

        return get_api_simulation_runs_response_200
