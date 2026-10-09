from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="CallConnectedAgentBodyRun")


@_attrs_define
class CallConnectedAgentBodyRun:
    """The simulation run this turn belongs to, if any.

    Attributes:
        scenario_run_id (str | Unset):
        scenario_name (str | Unset):
        batch_run_id (str | Unset):
    """

    scenario_run_id: str | Unset = UNSET
    scenario_name: str | Unset = UNSET
    batch_run_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        scenario_run_id = self.scenario_run_id

        scenario_name = self.scenario_name

        batch_run_id = self.batch_run_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if scenario_run_id is not UNSET:
            field_dict["scenarioRunId"] = scenario_run_id
        if scenario_name is not UNSET:
            field_dict["scenarioName"] = scenario_name
        if batch_run_id is not UNSET:
            field_dict["batchRunId"] = batch_run_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        scenario_run_id = d.pop("scenarioRunId", UNSET)

        scenario_name = d.pop("scenarioName", UNSET)

        batch_run_id = d.pop("batchRunId", UNSET)

        call_connected_agent_body_run = cls(
            scenario_run_id=scenario_run_id,
            scenario_name=scenario_name,
            batch_run_id=batch_run_id,
        )

        call_connected_agent_body_run.additional_properties = d
        return call_connected_agent_body_run

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
