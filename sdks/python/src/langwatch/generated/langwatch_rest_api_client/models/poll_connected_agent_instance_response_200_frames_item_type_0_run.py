from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="PollConnectedAgentInstanceResponse200FramesItemType0Run")


@_attrs_define
class PollConnectedAgentInstanceResponse200FramesItemType0Run:
    """
    Attributes:
        scenario_run_id (str | Unset):
        scenario_name (str | Unset):
        batch_run_id (str | Unset):
    """

    scenario_run_id: str | Unset = UNSET
    scenario_name: str | Unset = UNSET
    batch_run_id: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        scenario_run_id = self.scenario_run_id

        scenario_name = self.scenario_name

        batch_run_id = self.batch_run_id

        field_dict: dict[str, Any] = {}

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

        poll_connected_agent_instance_response_200_frames_item_type_0_run = cls(
            scenario_run_id=scenario_run_id,
            scenario_name=scenario_name,
            batch_run_id=batch_run_id,
        )

        return poll_connected_agent_instance_response_200_frames_item_type_0_run
