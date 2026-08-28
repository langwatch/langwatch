from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_scenario_events_body_type_0_metadata_langwatch_actor_label import (
    PostApiScenarioEventsBodyType0MetadataLangwatchActorLabel,
)
from ..models.post_api_scenario_events_body_type_0_metadata_langwatch_target_type import (
    PostApiScenarioEventsBodyType0MetadataLangwatchTargetType,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiScenarioEventsBodyType0MetadataLangwatch")


@_attrs_define
class PostApiScenarioEventsBodyType0MetadataLangwatch:
    """
    Attributes:
        target_reference_id (str):
        target_type (PostApiScenarioEventsBodyType0MetadataLangwatchTargetType):
        simulation_suite_id (str | Unset):
        scenario_version (int | Unset):
        simulator_model (str | Unset):
        judge_model (str | Unset):
        resolved_simulator_model (str | Unset):
        resolved_judge_model (str | Unset):
        actor_id (str | Unset):
        actor_label (PostApiScenarioEventsBodyType0MetadataLangwatchActorLabel | Unset):
    """

    target_reference_id: str
    target_type: PostApiScenarioEventsBodyType0MetadataLangwatchTargetType
    simulation_suite_id: str | Unset = UNSET
    scenario_version: int | Unset = UNSET
    simulator_model: str | Unset = UNSET
    judge_model: str | Unset = UNSET
    resolved_simulator_model: str | Unset = UNSET
    resolved_judge_model: str | Unset = UNSET
    actor_id: str | Unset = UNSET
    actor_label: PostApiScenarioEventsBodyType0MetadataLangwatchActorLabel | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        target_reference_id = self.target_reference_id

        target_type = self.target_type.value

        simulation_suite_id = self.simulation_suite_id

        scenario_version = self.scenario_version

        simulator_model = self.simulator_model

        judge_model = self.judge_model

        resolved_simulator_model = self.resolved_simulator_model

        resolved_judge_model = self.resolved_judge_model

        actor_id = self.actor_id

        actor_label: str | Unset = UNSET
        if not isinstance(self.actor_label, Unset):
            actor_label = self.actor_label.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "targetReferenceId": target_reference_id,
                "targetType": target_type,
            }
        )
        if simulation_suite_id is not UNSET:
            field_dict["simulationSuiteId"] = simulation_suite_id
        if scenario_version is not UNSET:
            field_dict["scenarioVersion"] = scenario_version
        if simulator_model is not UNSET:
            field_dict["simulatorModel"] = simulator_model
        if judge_model is not UNSET:
            field_dict["judgeModel"] = judge_model
        if resolved_simulator_model is not UNSET:
            field_dict["resolvedSimulatorModel"] = resolved_simulator_model
        if resolved_judge_model is not UNSET:
            field_dict["resolvedJudgeModel"] = resolved_judge_model
        if actor_id is not UNSET:
            field_dict["actorId"] = actor_id
        if actor_label is not UNSET:
            field_dict["actorLabel"] = actor_label

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        target_reference_id = d.pop("targetReferenceId")

        target_type = PostApiScenarioEventsBodyType0MetadataLangwatchTargetType(d.pop("targetType"))

        simulation_suite_id = d.pop("simulationSuiteId", UNSET)

        scenario_version = d.pop("scenarioVersion", UNSET)

        simulator_model = d.pop("simulatorModel", UNSET)

        judge_model = d.pop("judgeModel", UNSET)

        resolved_simulator_model = d.pop("resolvedSimulatorModel", UNSET)

        resolved_judge_model = d.pop("resolvedJudgeModel", UNSET)

        actor_id = d.pop("actorId", UNSET)

        _actor_label = d.pop("actorLabel", UNSET)
        actor_label: PostApiScenarioEventsBodyType0MetadataLangwatchActorLabel | Unset
        if isinstance(_actor_label, Unset):
            actor_label = UNSET
        else:
            actor_label = PostApiScenarioEventsBodyType0MetadataLangwatchActorLabel(_actor_label)

        post_api_scenario_events_body_type_0_metadata_langwatch = cls(
            target_reference_id=target_reference_id,
            target_type=target_type,
            simulation_suite_id=simulation_suite_id,
            scenario_version=scenario_version,
            simulator_model=simulator_model,
            judge_model=judge_model,
            resolved_simulator_model=resolved_simulator_model,
            resolved_judge_model=resolved_judge_model,
            actor_id=actor_id,
            actor_label=actor_label,
        )

        post_api_scenario_events_body_type_0_metadata_langwatch.additional_properties = d
        return post_api_scenario_events_body_type_0_metadata_langwatch

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
