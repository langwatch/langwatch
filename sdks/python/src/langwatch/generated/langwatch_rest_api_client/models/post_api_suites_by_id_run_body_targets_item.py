from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.post_api_suites_by_id_run_body_targets_item_type import PostApiSuitesByIdRunBodyTargetsItemType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_suites_by_id_run_body_targets_item_run_parameters import (
        PostApiSuitesByIdRunBodyTargetsItemRunParameters,
    )
    from ..models.post_api_suites_by_id_run_body_targets_item_scenario_mappings import (
        PostApiSuitesByIdRunBodyTargetsItemScenarioMappings,
    )


T = TypeVar("T", bound="PostApiSuitesByIdRunBodyTargetsItem")


@_attrs_define
class PostApiSuitesByIdRunBodyTargetsItem:
    """
    Attributes:
        type_ (PostApiSuitesByIdRunBodyTargetsItemType):
        reference_id (str):
        scenario_mappings (PostApiSuitesByIdRunBodyTargetsItemScenarioMappings | Unset):
        run_parameters (PostApiSuitesByIdRunBodyTargetsItemRunParameters | Unset):
        run_secret_parameter_names (list[str] | Unset):
    """

    type_: PostApiSuitesByIdRunBodyTargetsItemType
    reference_id: str
    scenario_mappings: PostApiSuitesByIdRunBodyTargetsItemScenarioMappings | Unset = UNSET
    run_parameters: PostApiSuitesByIdRunBodyTargetsItemRunParameters | Unset = UNSET
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
        from ..models.post_api_suites_by_id_run_body_targets_item_run_parameters import (
            PostApiSuitesByIdRunBodyTargetsItemRunParameters,
        )
        from ..models.post_api_suites_by_id_run_body_targets_item_scenario_mappings import (
            PostApiSuitesByIdRunBodyTargetsItemScenarioMappings,
        )

        d = dict(src_dict)
        type_ = PostApiSuitesByIdRunBodyTargetsItemType(d.pop("type"))

        reference_id = d.pop("referenceId")

        _scenario_mappings = d.pop("scenarioMappings", UNSET)
        scenario_mappings: PostApiSuitesByIdRunBodyTargetsItemScenarioMappings | Unset
        if isinstance(_scenario_mappings, Unset):
            scenario_mappings = UNSET
        else:
            scenario_mappings = PostApiSuitesByIdRunBodyTargetsItemScenarioMappings.from_dict(_scenario_mappings)

        _run_parameters = d.pop("runParameters", UNSET)
        run_parameters: PostApiSuitesByIdRunBodyTargetsItemRunParameters | Unset
        if isinstance(_run_parameters, Unset):
            run_parameters = UNSET
        else:
            run_parameters = PostApiSuitesByIdRunBodyTargetsItemRunParameters.from_dict(_run_parameters)

        run_secret_parameter_names = cast(list[str], d.pop("runSecretParameterNames", UNSET))

        post_api_suites_by_id_run_body_targets_item = cls(
            type_=type_,
            reference_id=reference_id,
            scenario_mappings=scenario_mappings,
            run_parameters=run_parameters,
            run_secret_parameter_names=run_secret_parameter_names,
        )

        return post_api_suites_by_id_run_body_targets_item
