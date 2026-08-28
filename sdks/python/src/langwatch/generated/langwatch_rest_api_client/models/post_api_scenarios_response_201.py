from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_scenarios_response_201_parameters_item import PostApiScenariosResponse201ParametersItem


T = TypeVar("T", bound="PostApiScenariosResponse201")


@_attrs_define
class PostApiScenariosResponse201:
    """
    Attributes:
        id (str):
        name (str):
        situation (str):
        criteria (list[str]):
        labels (list[str]):
        parameters (list[PostApiScenariosResponse201ParametersItem]):
        platform_url (str):
        simulator_model (None | str | Unset): The model that plays the user, or null for the project default. Absent on
            servers that predate model overrides on this family.
        judge_model (None | str | Unset): The model that judges the run, or null for the project default. Absent on
            servers that predate model overrides on this family.
        max_turns (int | None | Unset): The most conversation turns a run of this scenario takes, or null for the
            default. Absent on servers that predate turn limits on this family.
        min_turns (int | None | Unset): The fewest conversation turns before the judge may end a run, or null for the
            default. Absent on servers that predate turn limits on this family.
        test_suite_id (None | str | Unset): The test suite this scenario is filed in, or null when unfiled. Absent on
            servers that predate test suites.
    """

    id: str
    name: str
    situation: str
    criteria: list[str]
    labels: list[str]
    parameters: list[PostApiScenariosResponse201ParametersItem]
    platform_url: str
    simulator_model: None | str | Unset = UNSET
    judge_model: None | str | Unset = UNSET
    max_turns: int | None | Unset = UNSET
    min_turns: int | None | Unset = UNSET
    test_suite_id: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        situation = self.situation

        criteria = self.criteria

        labels = self.labels

        parameters = []
        for parameters_item_data in self.parameters:
            parameters_item = parameters_item_data.to_dict()
            parameters.append(parameters_item)

        platform_url = self.platform_url

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
        field_dict.update(
            {
                "id": id,
                "name": name,
                "situation": situation,
                "criteria": criteria,
                "labels": labels,
                "parameters": parameters,
                "platformUrl": platform_url,
            }
        )
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
        from ..models.post_api_scenarios_response_201_parameters_item import PostApiScenariosResponse201ParametersItem

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        situation = d.pop("situation")

        criteria = cast(list[str], d.pop("criteria"))

        labels = cast(list[str], d.pop("labels"))

        parameters = []
        _parameters = d.pop("parameters")
        for parameters_item_data in _parameters:
            parameters_item = PostApiScenariosResponse201ParametersItem.from_dict(parameters_item_data)

            parameters.append(parameters_item)

        platform_url = d.pop("platformUrl")

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

        post_api_scenarios_response_201 = cls(
            id=id,
            name=name,
            situation=situation,
            criteria=criteria,
            labels=labels,
            parameters=parameters,
            platform_url=platform_url,
            simulator_model=simulator_model,
            judge_model=judge_model,
            max_turns=max_turns,
            min_turns=min_turns,
            test_suite_id=test_suite_id,
        )

        post_api_scenarios_response_201.additional_properties = d
        return post_api_scenarios_response_201

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
