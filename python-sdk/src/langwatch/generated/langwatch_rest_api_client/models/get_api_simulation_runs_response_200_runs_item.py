from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_simulation_runs_response_200_runs_item_messages_item import (
        GetApiSimulationRunsResponse200RunsItemMessagesItem,
    )
    from ..models.get_api_simulation_runs_response_200_runs_item_results_type_0 import (
        GetApiSimulationRunsResponse200RunsItemResultsType0,
    )


T = TypeVar("T", bound="GetApiSimulationRunsResponse200RunsItem")


@_attrs_define
class GetApiSimulationRunsResponse200RunsItem:
    """
    Attributes:
        scenario_id (str):
        batch_run_id (str):
        scenario_run_id (str):
        name (None | str):
        description (None | str):
        status (str):
        results (GetApiSimulationRunsResponse200RunsItemResultsType0 | None):
        messages (list[GetApiSimulationRunsResponse200RunsItemMessagesItem]):
        timestamp (float):
        updated_at (float):
        duration_in_ms (float):
        total_cost (float | Unset):
    """

    scenario_id: str
    batch_run_id: str
    scenario_run_id: str
    name: None | str
    description: None | str
    status: str
    results: GetApiSimulationRunsResponse200RunsItemResultsType0 | None
    messages: list[GetApiSimulationRunsResponse200RunsItemMessagesItem]
    timestamp: float
    updated_at: float
    duration_in_ms: float
    total_cost: float | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_simulation_runs_response_200_runs_item_results_type_0 import (
            GetApiSimulationRunsResponse200RunsItemResultsType0,
        )

        scenario_id = self.scenario_id

        batch_run_id = self.batch_run_id

        scenario_run_id = self.scenario_run_id

        name: None | str
        name = self.name

        description: None | str
        description = self.description

        status = self.status

        results: dict[str, Any] | None
        if isinstance(self.results, GetApiSimulationRunsResponse200RunsItemResultsType0):
            results = self.results.to_dict()
        else:
            results = self.results

        messages = []
        for messages_item_data in self.messages:
            messages_item = messages_item_data.to_dict()
            messages.append(messages_item)

        timestamp = self.timestamp

        updated_at = self.updated_at

        duration_in_ms = self.duration_in_ms

        total_cost = self.total_cost

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "scenarioId": scenario_id,
                "batchRunId": batch_run_id,
                "scenarioRunId": scenario_run_id,
                "name": name,
                "description": description,
                "status": status,
                "results": results,
                "messages": messages,
                "timestamp": timestamp,
                "updatedAt": updated_at,
                "durationInMs": duration_in_ms,
            }
        )
        if total_cost is not UNSET:
            field_dict["totalCost"] = total_cost

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_simulation_runs_response_200_runs_item_messages_item import (
            GetApiSimulationRunsResponse200RunsItemMessagesItem,
        )
        from ..models.get_api_simulation_runs_response_200_runs_item_results_type_0 import (
            GetApiSimulationRunsResponse200RunsItemResultsType0,
        )

        d = dict(src_dict)
        scenario_id = d.pop("scenarioId")

        batch_run_id = d.pop("batchRunId")

        scenario_run_id = d.pop("scenarioRunId")

        def _parse_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        name = _parse_name(d.pop("name"))

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))

        status = d.pop("status")

        def _parse_results(data: object) -> GetApiSimulationRunsResponse200RunsItemResultsType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                results_type_0 = GetApiSimulationRunsResponse200RunsItemResultsType0.from_dict(data)

                return results_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiSimulationRunsResponse200RunsItemResultsType0 | None, data)

        results = _parse_results(d.pop("results"))

        messages = []
        _messages = d.pop("messages")
        for messages_item_data in _messages:
            messages_item = GetApiSimulationRunsResponse200RunsItemMessagesItem.from_dict(messages_item_data)

            messages.append(messages_item)

        timestamp = d.pop("timestamp")

        updated_at = d.pop("updatedAt")

        duration_in_ms = d.pop("durationInMs")

        total_cost = d.pop("totalCost", UNSET)

        get_api_simulation_runs_response_200_runs_item = cls(
            scenario_id=scenario_id,
            batch_run_id=batch_run_id,
            scenario_run_id=scenario_run_id,
            name=name,
            description=description,
            status=status,
            results=results,
            messages=messages,
            timestamp=timestamp,
            updated_at=updated_at,
            duration_in_ms=duration_in_ms,
            total_cost=total_cost,
        )

        get_api_simulation_runs_response_200_runs_item.additional_properties = d
        return get_api_simulation_runs_response_200_runs_item

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
