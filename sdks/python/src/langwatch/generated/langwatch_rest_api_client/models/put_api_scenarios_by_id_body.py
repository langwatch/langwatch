from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.put_api_scenarios_by_id_body_parameters_item import PutApiScenariosByIdBodyParametersItem


T = TypeVar("T", bound="PutApiScenariosByIdBody")


@_attrs_define
class PutApiScenariosByIdBody:
    """
    Attributes:
        name (str | Unset):
        situation (str | Unset):
        criteria (list[str] | Unset):
        labels (list[str] | Unset):
        parameters (list[PutApiScenariosByIdBodyParametersItem] | Unset): The parameters this scenario declares by name,
            each with an optional description and default. A run supplies values for these names, readable from the
            scenario's own text as params.NAME. A parameter marked secret carries no default: its value is supplied per run,
            encrypted, delivered to the target as secrets.NAME, and never readable from the scenario's own text.
        simulator_model (None | str | Unset): Model for the simulated user, e.g. openai/gpt-5-mini. Null uses the
            project default.
        judge_model (None | str | Unset): Model for the judge, e.g. openai/gpt-5-mini. Null uses the project default.
        max_turns (int | None | Unset): Maximum conversation turns for a run of this scenario. Null uses the default.
        min_turns (int | None | Unset): Minimum conversation turns before the judge may end the run. Null uses the
            default.
        test_suite_id (None | str | Unset): The test suite to file this scenario in. It must name a non-archived test
            suite of the same project. null files the scenario into the project's Default test suite.
    """

    name: str | Unset = UNSET
    situation: str | Unset = UNSET
    criteria: list[str] | Unset = UNSET
    labels: list[str] | Unset = UNSET
    parameters: list[PutApiScenariosByIdBodyParametersItem] | Unset = UNSET
    simulator_model: None | str | Unset = UNSET
    judge_model: None | str | Unset = UNSET
    max_turns: int | None | Unset = UNSET
    min_turns: int | None | Unset = UNSET
    test_suite_id: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        situation = self.situation

        criteria: list[str] | Unset = UNSET
        if not isinstance(self.criteria, Unset):
            criteria = self.criteria

        labels: list[str] | Unset = UNSET
        if not isinstance(self.labels, Unset):
            labels = self.labels

        parameters: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.parameters, Unset):
            parameters = []
            for parameters_item_data in self.parameters:
                parameters_item = parameters_item_data.to_dict()
                parameters.append(parameters_item)

        simulator_model: None | str | Unset
        if isinstance(self.simulator_model, Unset):
            simulator_model = UNSET
        else:
            simulator_model = self.simulator_model

        judge_model: None | str | Unset
        if isinstance(self.judge_model, Unset):
            judge_model = UNSET
        else:
            judge_model = self.judge_model

        max_turns: int | None | Unset
        if isinstance(self.max_turns, Unset):
            max_turns = UNSET
        else:
            max_turns = self.max_turns

        min_turns: int | None | Unset
        if isinstance(self.min_turns, Unset):
            min_turns = UNSET
        else:
            min_turns = self.min_turns

        test_suite_id: None | str | Unset
        if isinstance(self.test_suite_id, Unset):
            test_suite_id = UNSET
        else:
            test_suite_id = self.test_suite_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if situation is not UNSET:
            field_dict["situation"] = situation
        if criteria is not UNSET:
            field_dict["criteria"] = criteria
        if labels is not UNSET:
            field_dict["labels"] = labels
        if parameters is not UNSET:
            field_dict["parameters"] = parameters
        if simulator_model is not UNSET:
            field_dict["simulatorModel"] = simulator_model
        if judge_model is not UNSET:
            field_dict["judgeModel"] = judge_model
        if max_turns is not UNSET:
            field_dict["maxTurns"] = max_turns
        if min_turns is not UNSET:
            field_dict["minTurns"] = min_turns
        if test_suite_id is not UNSET:
            field_dict["testSuiteId"] = test_suite_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.put_api_scenarios_by_id_body_parameters_item import PutApiScenariosByIdBodyParametersItem

        d = dict(src_dict)
        name = d.pop("name", UNSET)

        situation = d.pop("situation", UNSET)

        criteria = cast(list[str], d.pop("criteria", UNSET))

        labels = cast(list[str], d.pop("labels", UNSET))

        _parameters = d.pop("parameters", UNSET)
        parameters: list[PutApiScenariosByIdBodyParametersItem] | Unset = UNSET
        if _parameters is not UNSET:
            parameters = []
            for parameters_item_data in _parameters:
                parameters_item = PutApiScenariosByIdBodyParametersItem.from_dict(parameters_item_data)

                parameters.append(parameters_item)

        def _parse_simulator_model(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        simulator_model = _parse_simulator_model(d.pop("simulatorModel", UNSET))

        def _parse_judge_model(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        judge_model = _parse_judge_model(d.pop("judgeModel", UNSET))

        def _parse_max_turns(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        max_turns = _parse_max_turns(d.pop("maxTurns", UNSET))

        def _parse_min_turns(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        min_turns = _parse_min_turns(d.pop("minTurns", UNSET))

        def _parse_test_suite_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        test_suite_id = _parse_test_suite_id(d.pop("testSuiteId", UNSET))

        put_api_scenarios_by_id_body = cls(
            name=name,
            situation=situation,
            criteria=criteria,
            labels=labels,
            parameters=parameters,
            simulator_model=simulator_model,
            judge_model=judge_model,
            max_turns=max_turns,
            min_turns=min_turns,
            test_suite_id=test_suite_id,
        )

        put_api_scenarios_by_id_body.additional_properties = d
        return put_api_scenarios_by_id_body

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
