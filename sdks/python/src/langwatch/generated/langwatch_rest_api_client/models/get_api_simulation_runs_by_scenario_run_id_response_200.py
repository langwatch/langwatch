from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_simulation_runs_by_scenario_run_id_response_200_messages_item import (
        GetApiSimulationRunsByScenarioRunIdResponse200MessagesItem,
    )
    from ..models.get_api_simulation_runs_by_scenario_run_id_response_200_results_type_0 import (
        GetApiSimulationRunsByScenarioRunIdResponse200ResultsType0,
    )
    from ..models.get_api_simulation_runs_by_scenario_run_id_response_200_role_costs import (
        GetApiSimulationRunsByScenarioRunIdResponse200RoleCosts,
    )
    from ..models.get_api_simulation_runs_by_scenario_run_id_response_200_role_latencies import (
        GetApiSimulationRunsByScenarioRunIdResponse200RoleLatencies,
    )


T = TypeVar("T", bound="GetApiSimulationRunsByScenarioRunIdResponse200")


@_attrs_define
class GetApiSimulationRunsByScenarioRunIdResponse200:
    """
    Attributes:
        scenario_id (str):
        batch_run_id (str):
        scenario_run_id (str):
        name (None | str):
        description (None | str):
        status (str):
        results (GetApiSimulationRunsByScenarioRunIdResponse200ResultsType0 | None):
        messages (list[GetApiSimulationRunsByScenarioRunIdResponse200MessagesItem]):
        timestamp (float):
        updated_at (float):
        duration_in_ms (float):
        platform_url (str):
        scenario_set_id (str | Unset):
        messages_truncated (bool | Unset): True when `messages` holds only the first few messages of a longer
            conversation. Pass `include=messages` to read them all.
        total_cost (float | Unset):
        role_costs (GetApiSimulationRunsByScenarioRunIdResponse200RoleCosts | Unset):
        role_latencies (GetApiSimulationRunsByScenarioRunIdResponse200RoleLatencies | Unset):
        note (None | str | Unset): One short line saying why the run was started, as given when it was queued. Null on a
            run started without one.
        scenario_version (int | None | Unset): The version of the scenario at the moment the run was queued. Null on
            runs recorded before versions existed.
    """

    scenario_id: str
    batch_run_id: str
    scenario_run_id: str
    name: None | str
    description: None | str
    status: str
    results: GetApiSimulationRunsByScenarioRunIdResponse200ResultsType0 | None
    messages: list[GetApiSimulationRunsByScenarioRunIdResponse200MessagesItem]
    timestamp: float
    updated_at: float
    duration_in_ms: float
    platform_url: str
    scenario_set_id: str | Unset = UNSET
    messages_truncated: bool | Unset = UNSET
    total_cost: float | Unset = UNSET
    role_costs: GetApiSimulationRunsByScenarioRunIdResponse200RoleCosts | Unset = UNSET
    role_latencies: GetApiSimulationRunsByScenarioRunIdResponse200RoleLatencies | Unset = UNSET
    note: None | str | Unset = UNSET
    scenario_version: int | None | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_simulation_runs_by_scenario_run_id_response_200_results_type_0 import (
            GetApiSimulationRunsByScenarioRunIdResponse200ResultsType0,
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
        if isinstance(self.results, GetApiSimulationRunsByScenarioRunIdResponse200ResultsType0):
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

        platform_url = self.platform_url

        scenario_set_id = self.scenario_set_id

        messages_truncated = self.messages_truncated

        total_cost = self.total_cost

        role_costs: dict[str, Any] | Unset = UNSET
        if not isinstance(self.role_costs, Unset):
            role_costs = self.role_costs.to_dict()

        role_latencies: dict[str, Any] | Unset = UNSET
        if not isinstance(self.role_latencies, Unset):
            role_latencies = self.role_latencies.to_dict()

        note: None | str | Unset
        if isinstance(self.note, Unset):
            note = UNSET
        else:
            note = self.note

        scenario_version: int | None | Unset
        if isinstance(self.scenario_version, Unset):
            scenario_version = UNSET
        else:
            scenario_version = self.scenario_version

        field_dict: dict[str, Any] = {}

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
                "platformUrl": platform_url,
            }
        )
        if scenario_set_id is not UNSET:
            field_dict["scenarioSetId"] = scenario_set_id
        if messages_truncated is not UNSET:
            field_dict["messagesTruncated"] = messages_truncated
        if total_cost is not UNSET:
            field_dict["totalCost"] = total_cost
        if role_costs is not UNSET:
            field_dict["roleCosts"] = role_costs
        if role_latencies is not UNSET:
            field_dict["roleLatencies"] = role_latencies
        if note is not UNSET:
            field_dict["note"] = note
        if scenario_version is not UNSET:
            field_dict["scenarioVersion"] = scenario_version

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_simulation_runs_by_scenario_run_id_response_200_messages_item import (
            GetApiSimulationRunsByScenarioRunIdResponse200MessagesItem,
        )
        from ..models.get_api_simulation_runs_by_scenario_run_id_response_200_results_type_0 import (
            GetApiSimulationRunsByScenarioRunIdResponse200ResultsType0,
        )
        from ..models.get_api_simulation_runs_by_scenario_run_id_response_200_role_costs import (
            GetApiSimulationRunsByScenarioRunIdResponse200RoleCosts,
        )
        from ..models.get_api_simulation_runs_by_scenario_run_id_response_200_role_latencies import (
            GetApiSimulationRunsByScenarioRunIdResponse200RoleLatencies,
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

        def _parse_results(data: object) -> GetApiSimulationRunsByScenarioRunIdResponse200ResultsType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                results_type_0 = GetApiSimulationRunsByScenarioRunIdResponse200ResultsType0.from_dict(data)

                return results_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiSimulationRunsByScenarioRunIdResponse200ResultsType0 | None, data)

        results = _parse_results(d.pop("results"))

        messages = []
        _messages = d.pop("messages")
        for messages_item_data in _messages:
            messages_item = GetApiSimulationRunsByScenarioRunIdResponse200MessagesItem.from_dict(messages_item_data)

            messages.append(messages_item)

        timestamp = d.pop("timestamp")

        updated_at = d.pop("updatedAt")

        duration_in_ms = d.pop("durationInMs")

        platform_url = d.pop("platformUrl")

        scenario_set_id = d.pop("scenarioSetId", UNSET)

        messages_truncated = d.pop("messagesTruncated", UNSET)

        total_cost = d.pop("totalCost", UNSET)

        _role_costs = d.pop("roleCosts", UNSET)
        role_costs: GetApiSimulationRunsByScenarioRunIdResponse200RoleCosts | Unset
        if isinstance(_role_costs, Unset):
            role_costs = UNSET
        else:
            role_costs = GetApiSimulationRunsByScenarioRunIdResponse200RoleCosts.from_dict(_role_costs)

        _role_latencies = d.pop("roleLatencies", UNSET)
        role_latencies: GetApiSimulationRunsByScenarioRunIdResponse200RoleLatencies | Unset
        if isinstance(_role_latencies, Unset):
            role_latencies = UNSET
        else:
            role_latencies = GetApiSimulationRunsByScenarioRunIdResponse200RoleLatencies.from_dict(_role_latencies)

        def _parse_note(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        note = _parse_note(d.pop("note", UNSET))

        def _parse_scenario_version(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        scenario_version = _parse_scenario_version(d.pop("scenarioVersion", UNSET))

        get_api_simulation_runs_by_scenario_run_id_response_200 = cls(
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
            platform_url=platform_url,
            scenario_set_id=scenario_set_id,
            messages_truncated=messages_truncated,
            total_cost=total_cost,
            role_costs=role_costs,
            role_latencies=role_latencies,
            note=note,
            scenario_version=scenario_version,
        )

        return get_api_simulation_runs_by_scenario_run_id_response_200
