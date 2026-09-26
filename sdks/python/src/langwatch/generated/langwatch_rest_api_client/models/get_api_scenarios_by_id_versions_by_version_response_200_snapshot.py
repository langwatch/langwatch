from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_scenarios_by_id_versions_by_version_response_200_snapshot_parameters_item import (
        GetApiScenariosByIdVersionsByVersionResponse200SnapshotParametersItem,
    )


T = TypeVar("T", bound="GetApiScenariosByIdVersionsByVersionResponse200Snapshot")


@_attrs_define
class GetApiScenariosByIdVersionsByVersionResponse200Snapshot:
    """The editable content of the case as this version saved it.

    Attributes:
        name (str):
        situation (str):
        criteria (list[str]):
        labels (list[str]):
        parameters (list[GetApiScenariosByIdVersionsByVersionResponse200SnapshotParametersItem]):
        simulator_model (None | str):
        judge_model (None | str):
        max_turns (float | None):
        min_turns (float | None):
    """

    name: str
    situation: str
    criteria: list[str]
    labels: list[str]
    parameters: list[GetApiScenariosByIdVersionsByVersionResponse200SnapshotParametersItem]
    simulator_model: None | str
    judge_model: None | str
    max_turns: float | None
    min_turns: float | None
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        situation = self.situation

        criteria = self.criteria

        labels = self.labels

        parameters = []
        for parameters_item_data in self.parameters:
            parameters_item = parameters_item_data.to_dict()
            parameters.append(parameters_item)

        simulator_model: None | str
        simulator_model = self.simulator_model

        judge_model: None | str
        judge_model = self.judge_model

        max_turns: float | None
        max_turns = self.max_turns

        min_turns: float | None
        min_turns = self.min_turns

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "situation": situation,
                "criteria": criteria,
                "labels": labels,
                "parameters": parameters,
                "simulatorModel": simulator_model,
                "judgeModel": judge_model,
                "maxTurns": max_turns,
                "minTurns": min_turns,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_scenarios_by_id_versions_by_version_response_200_snapshot_parameters_item import (
            GetApiScenariosByIdVersionsByVersionResponse200SnapshotParametersItem,
        )

        d = dict(src_dict)
        name = d.pop("name")

        situation = d.pop("situation")

        criteria = cast(list[str], d.pop("criteria"))

        labels = cast(list[str], d.pop("labels"))

        parameters = []
        _parameters = d.pop("parameters")
        for parameters_item_data in _parameters:
            parameters_item = GetApiScenariosByIdVersionsByVersionResponse200SnapshotParametersItem.from_dict(
                parameters_item_data
            )

            parameters.append(parameters_item)

        def _parse_simulator_model(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        simulator_model = _parse_simulator_model(d.pop("simulatorModel"))

        def _parse_judge_model(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        judge_model = _parse_judge_model(d.pop("judgeModel"))

        def _parse_max_turns(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        max_turns = _parse_max_turns(d.pop("maxTurns"))

        def _parse_min_turns(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        min_turns = _parse_min_turns(d.pop("minTurns"))

        get_api_scenarios_by_id_versions_by_version_response_200_snapshot = cls(
            name=name,
            situation=situation,
            criteria=criteria,
            labels=labels,
            parameters=parameters,
            simulator_model=simulator_model,
            judge_model=judge_model,
            max_turns=max_turns,
            min_turns=min_turns,
        )

        get_api_scenarios_by_id_versions_by_version_response_200_snapshot.additional_properties = d
        return get_api_scenarios_by_id_versions_by_version_response_200_snapshot

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
