from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.run_run_plan_body_config_targets_item_type import RunRunPlanBodyConfigTargetsItemType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.run_run_plan_body_config_targets_item_run_parameters import (
        RunRunPlanBodyConfigTargetsItemRunParameters,
    )
    from ..models.run_run_plan_body_config_targets_item_scenario_mappings import (
        RunRunPlanBodyConfigTargetsItemScenarioMappings,
    )


T = TypeVar("T", bound="RunRunPlanBodyConfigTargetsItem")


@_attrs_define
class RunRunPlanBodyConfigTargetsItem:
    """
    Attributes:
        type_ (RunRunPlanBodyConfigTargetsItemType):
        reference_id (str):
        scenario_mappings (RunRunPlanBodyConfigTargetsItemScenarioMappings | Unset):
        run_parameters (RunRunPlanBodyConfigTargetsItemRunParameters | Unset):
        run_secret_parameter_names (list[str] | Unset):
    """

    type_: RunRunPlanBodyConfigTargetsItemType
    reference_id: str
    scenario_mappings: RunRunPlanBodyConfigTargetsItemScenarioMappings | Unset = UNSET
    run_parameters: RunRunPlanBodyConfigTargetsItemRunParameters | Unset = UNSET
    run_secret_parameter_names: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        reference_id = self.reference_id

        scenario_mappings: dict[str, Any] | Unset = UNSET
        if not isinstance(self.scenario_mappings, Unset):
            scenario_mappings = self.scenario_mappings.to_dict()

        run_parameters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.run_parameters, Unset):
            run_parameters = self.run_parameters.to_dict()

        run_secret_parameter_names: list[str] | Unset = UNSET
        if not isinstance(self.run_secret_parameter_names, Unset):
            run_secret_parameter_names = self.run_secret_parameter_names

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "referenceId": reference_id,
            }
        )
        if scenario_mappings is not UNSET:
            field_dict["scenarioMappings"] = scenario_mappings
        if run_parameters is not UNSET:
            field_dict["runParameters"] = run_parameters
        if run_secret_parameter_names is not UNSET:
            field_dict["runSecretParameterNames"] = run_secret_parameter_names

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.run_run_plan_body_config_targets_item_run_parameters import (
            RunRunPlanBodyConfigTargetsItemRunParameters,
        )
        from ..models.run_run_plan_body_config_targets_item_scenario_mappings import (
            RunRunPlanBodyConfigTargetsItemScenarioMappings,
        )

        d = dict(src_dict)
        type_ = RunRunPlanBodyConfigTargetsItemType(d.pop("type"))

        reference_id = d.pop("referenceId")

        _scenario_mappings = d.pop("scenarioMappings", UNSET)
        scenario_mappings: RunRunPlanBodyConfigTargetsItemScenarioMappings | Unset
        if isinstance(_scenario_mappings, Unset):
            scenario_mappings = UNSET
        else:
            scenario_mappings = RunRunPlanBodyConfigTargetsItemScenarioMappings.from_dict(_scenario_mappings)

        _run_parameters = d.pop("runParameters", UNSET)
        run_parameters: RunRunPlanBodyConfigTargetsItemRunParameters | Unset
        if isinstance(_run_parameters, Unset):
            run_parameters = UNSET
        else:
            run_parameters = RunRunPlanBodyConfigTargetsItemRunParameters.from_dict(_run_parameters)

        run_secret_parameter_names = cast(list[str], d.pop("runSecretParameterNames", UNSET))

        run_run_plan_body_config_targets_item = cls(
            type_=type_,
            reference_id=reference_id,
            scenario_mappings=scenario_mappings,
            run_parameters=run_parameters,
            run_secret_parameter_names=run_secret_parameter_names,
        )

        return run_run_plan_body_config_targets_item
