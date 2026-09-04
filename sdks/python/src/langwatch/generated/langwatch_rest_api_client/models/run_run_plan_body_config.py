from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.run_run_plan_body_config_scope_type_0 import RunRunPlanBodyConfigScopeType0
    from ..models.run_run_plan_body_config_scope_type_1 import RunRunPlanBodyConfigScopeType1
    from ..models.run_run_plan_body_config_scope_type_2 import RunRunPlanBodyConfigScopeType2
    from ..models.run_run_plan_body_config_scope_type_3 import RunRunPlanBodyConfigScopeType3
    from ..models.run_run_plan_body_config_targets_item import RunRunPlanBodyConfigTargetsItem


T = TypeVar("T", bound="RunRunPlanBodyConfig")


@_attrs_define
class RunRunPlanBodyConfig:
    """What this run covers and what it runs against. Written onto the run plan the name resolves.

    Attributes:
        scope (RunRunPlanBodyConfigScopeType0 | RunRunPlanBodyConfigScopeType1 | RunRunPlanBodyConfigScopeType2 |
            RunRunPlanBodyConfigScopeType3): What the run plan covers: all (every active scenario), test_suites (the
            scenarios filed in the named test suites), labels (the scenarios carrying any of the labels), or scenarios (the
            scenarioIds sent with the configuration). A dynamic scope is resolved again at every run, so a scenario written
            later runs without editing the plan.
        targets (list[RunRunPlanBodyConfigTargetsItem]): The prompts, agents or workflows every scenario runs against.
            Every target runs every scenario, so naming more than one compares them in the same run.
        repeat_count (int | Unset): How many times each scenario and target pairing runs. Between 1 and 5; defaults to
            1.
        simulator_model (None | str | Unset): The model that plays the user for every scenario in the run. Overrides
            each scenario's own choice. Leave it out for the scenario or project default.
        judge_model (None | str | Unset): The model that judges every scenario in the run. Overrides each scenario's own
            choice. Leave it out for the scenario or project default.
        scenario_ids (list[str] | Unset): The scenarios a test_suites or scenarios scope covers. Read by a scenarios
            scope alone; a scope that states a rule resolves its own list at run time.
    """

    scope: (
        RunRunPlanBodyConfigScopeType0
        | RunRunPlanBodyConfigScopeType1
        | RunRunPlanBodyConfigScopeType2
        | RunRunPlanBodyConfigScopeType3
    )
    targets: list[RunRunPlanBodyConfigTargetsItem]
    repeat_count: int | Unset = UNSET
    simulator_model: None | str | Unset = UNSET
    judge_model: None | str | Unset = UNSET
    scenario_ids: list[str] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.run_run_plan_body_config_scope_type_0 import RunRunPlanBodyConfigScopeType0
        from ..models.run_run_plan_body_config_scope_type_1 import RunRunPlanBodyConfigScopeType1
        from ..models.run_run_plan_body_config_scope_type_2 import RunRunPlanBodyConfigScopeType2

        scope: dict[str, Any]
        if isinstance(self.scope, RunRunPlanBodyConfigScopeType0):
            scope = self.scope.to_dict()
        elif isinstance(self.scope, RunRunPlanBodyConfigScopeType1):
            scope = self.scope.to_dict()
        elif isinstance(self.scope, RunRunPlanBodyConfigScopeType2):
            scope = self.scope.to_dict()
        else:
            scope = self.scope.to_dict()

        targets = []
        for targets_item_data in self.targets:
            targets_item = targets_item_data.to_dict()
            targets.append(targets_item)

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

        scenario_ids: list[str] | Unset = UNSET
        if not isinstance(self.scenario_ids, Unset):
            scenario_ids = self.scenario_ids

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "scope": scope,
                "targets": targets,
            }
        )
        if repeat_count is not UNSET:
            field_dict["repeatCount"] = repeat_count
        if simulator_model is not UNSET:
            field_dict["simulatorModel"] = simulator_model
        if judge_model is not UNSET:
            field_dict["judgeModel"] = judge_model
        if scenario_ids is not UNSET:
            field_dict["scenarioIds"] = scenario_ids

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.run_run_plan_body_config_scope_type_0 import RunRunPlanBodyConfigScopeType0
        from ..models.run_run_plan_body_config_scope_type_1 import RunRunPlanBodyConfigScopeType1
        from ..models.run_run_plan_body_config_scope_type_2 import RunRunPlanBodyConfigScopeType2
        from ..models.run_run_plan_body_config_scope_type_3 import RunRunPlanBodyConfigScopeType3
        from ..models.run_run_plan_body_config_targets_item import RunRunPlanBodyConfigTargetsItem

        d = dict(src_dict)

        def _parse_scope(
            data: object,
        ) -> (
            RunRunPlanBodyConfigScopeType0
            | RunRunPlanBodyConfigScopeType1
            | RunRunPlanBodyConfigScopeType2
            | RunRunPlanBodyConfigScopeType3
        ):
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                scope_type_0 = RunRunPlanBodyConfigScopeType0.from_dict(data)

                return scope_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                scope_type_1 = RunRunPlanBodyConfigScopeType1.from_dict(data)

                return scope_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                scope_type_2 = RunRunPlanBodyConfigScopeType2.from_dict(data)

                return scope_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            scope_type_3 = RunRunPlanBodyConfigScopeType3.from_dict(data)

            return scope_type_3

        scope = _parse_scope(d.pop("scope"))

        targets = []
        _targets = d.pop("targets")
        for targets_item_data in _targets:
            targets_item = RunRunPlanBodyConfigTargetsItem.from_dict(targets_item_data)

            targets.append(targets_item)

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

        scenario_ids = cast(list[str], d.pop("scenarioIds", UNSET))

        run_run_plan_body_config = cls(
            scope=scope,
            targets=targets,
            repeat_count=repeat_count,
            simulator_model=simulator_model,
            judge_model=judge_model,
            scenario_ids=scenario_ids,
        )

        run_run_plan_body_config.additional_properties = d
        return run_run_plan_body_config

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
