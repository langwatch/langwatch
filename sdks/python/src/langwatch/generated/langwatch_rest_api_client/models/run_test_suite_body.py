from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.run_test_suite_body_parameters import RunTestSuiteBodyParameters
    from ..models.run_test_suite_body_targets_item import RunTestSuiteBodyTargetsItem


T = TypeVar("T", bound="RunTestSuiteBody")


@_attrs_define
class RunTestSuiteBody:
    """
    Attributes:
        targets (list[RunTestSuiteBodyTargetsItem]): The prompts, agents or workflows the suite runs against. A test
            suite stores none of its own, so a run states them.
        name (str | Unset): The run plan this run joins or creates. Leave it out and the name is derived from the suite
            name and the targets.
        repeat_count (int | Unset): How many times each scenario and target pairing runs. Between 1 and 5; defaults to
            1.
        simulator_model (None | str | Unset): The model that plays the user for every scenario in this run. Leave it out
            for the scenario or project default.
        judge_model (None | str | Unset): The model that judges every scenario in this run. Leave it out for the
            scenario or project default.
        idempotency_key (str | Unset): Repeat the same key to make a retry join the batch the first call started instead
            of running everything again. Defaults to a new key per call.
        parameters (RunTestSuiteBodyParameters | Unset): Constant values applied to every scenario in the run, e.g. a
            fixture id or a tenant. A value supplied here overrides the scenario's own default for that name.
        note (str | Unset): One short line describing why this batch was run, e.g. a commit hash or what you changed. It
            is stored on every run of the batch and shown beside the run in the platform. Up to 200 characters.
    """

    targets: list[RunTestSuiteBodyTargetsItem]
    name: str | Unset = UNSET
    repeat_count: int | Unset = UNSET
    simulator_model: None | str | Unset = UNSET
    judge_model: None | str | Unset = UNSET
    idempotency_key: str | Unset = UNSET
    parameters: RunTestSuiteBodyParameters | Unset = UNSET
    note: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        targets = []
        for targets_item_data in self.targets:
            targets_item = targets_item_data.to_dict()
            targets.append(targets_item)

        name = self.name

        repeat_count = self.repeat_count

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

        idempotency_key = self.idempotency_key

        parameters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.parameters, Unset):
            parameters = self.parameters.to_dict()

        note = self.note

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "targets": targets,
            }
        )
        if name is not UNSET:
            field_dict["name"] = name
        if repeat_count is not UNSET:
            field_dict["repeatCount"] = repeat_count
        if simulator_model is not UNSET:
            field_dict["simulatorModel"] = simulator_model
        if judge_model is not UNSET:
            field_dict["judgeModel"] = judge_model
        if idempotency_key is not UNSET:
            field_dict["idempotencyKey"] = idempotency_key
        if parameters is not UNSET:
            field_dict["parameters"] = parameters
        if note is not UNSET:
            field_dict["note"] = note

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.run_test_suite_body_parameters import RunTestSuiteBodyParameters
        from ..models.run_test_suite_body_targets_item import RunTestSuiteBodyTargetsItem

        d = dict(src_dict)
        targets = []
        _targets = d.pop("targets")
        for targets_item_data in _targets:
            targets_item = RunTestSuiteBodyTargetsItem.from_dict(targets_item_data)

            targets.append(targets_item)

        name = d.pop("name", UNSET)

        repeat_count = d.pop("repeatCount", UNSET)

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

        idempotency_key = d.pop("idempotencyKey", UNSET)

        _parameters = d.pop("parameters", UNSET)
        parameters: RunTestSuiteBodyParameters | Unset
        if isinstance(_parameters, Unset):
            parameters = UNSET
        else:
            parameters = RunTestSuiteBodyParameters.from_dict(_parameters)

        note = d.pop("note", UNSET)

        run_test_suite_body = cls(
            targets=targets,
            name=name,
            repeat_count=repeat_count,
            simulator_model=simulator_model,
            judge_model=judge_model,
            idempotency_key=idempotency_key,
            parameters=parameters,
            note=note,
        )

        run_test_suite_body.additional_properties = d
        return run_test_suite_body

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
