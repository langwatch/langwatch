from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="TestAgentResponse200")


@_attrs_define
class TestAgentResponse200:
    """
    Attributes:
        scenario_run_id (str): The run to follow; open it in the simulations run drawer.
        batch_run_id (str): The batch the run belongs to.
        set_id (str): The internal set that holds agent test runs.
    """

    scenario_run_id: str
    batch_run_id: str
    set_id: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        scenario_run_id = self.scenario_run_id

        batch_run_id = self.batch_run_id

        set_id = self.set_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "scenarioRunId": scenario_run_id,
                "batchRunId": batch_run_id,
                "setId": set_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        scenario_run_id = d.pop("scenarioRunId")

        batch_run_id = d.pop("batchRunId")

        set_id = d.pop("setId")

        test_agent_response_200 = cls(
            scenario_run_id=scenario_run_id,
            batch_run_id=batch_run_id,
            set_id=set_id,
        )

        test_agent_response_200.additional_properties = d
        return test_agent_response_200

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
