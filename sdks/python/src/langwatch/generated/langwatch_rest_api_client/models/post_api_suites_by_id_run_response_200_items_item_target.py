from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.post_api_suites_by_id_run_response_200_items_item_target_type import (
    PostApiSuitesByIdRunResponse200ItemsItemTargetType,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_suites_by_id_run_response_200_items_item_target_run_parameters import (
        PostApiSuitesByIdRunResponse200ItemsItemTargetRunParameters,
    )
    from ..models.post_api_suites_by_id_run_response_200_items_item_target_scenario_mappings import (
        PostApiSuitesByIdRunResponse200ItemsItemTargetScenarioMappings,
    )


T = TypeVar("T", bound="PostApiSuitesByIdRunResponse200ItemsItemTarget")


@_attrs_define
class PostApiSuitesByIdRunResponse200ItemsItemTarget:
    """
    Attributes:
        type_ (PostApiSuitesByIdRunResponse200ItemsItemTargetType):
        reference_id (str):
        scenario_mappings (PostApiSuitesByIdRunResponse200ItemsItemTargetScenarioMappings | Unset):
        run_parameters (PostApiSuitesByIdRunResponse200ItemsItemTargetRunParameters | Unset):
        run_secret_parameter_names (list[str] | Unset):
    """

    type_: PostApiSuitesByIdRunResponse200ItemsItemTargetType
    reference_id: str
    scenario_mappings: PostApiSuitesByIdRunResponse200ItemsItemTargetScenarioMappings | Unset = UNSET
    run_parameters: PostApiSuitesByIdRunResponse200ItemsItemTargetRunParameters | Unset = UNSET
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
        from ..models.post_api_suites_by_id_run_response_200_items_item_target_run_parameters import (
            PostApiSuitesByIdRunResponse200ItemsItemTargetRunParameters,
        )
        from ..models.post_api_suites_by_id_run_response_200_items_item_target_scenario_mappings import (
            PostApiSuitesByIdRunResponse200ItemsItemTargetScenarioMappings,
        )

        d = dict(src_dict)
        type_ = PostApiSuitesByIdRunResponse200ItemsItemTargetType(d.pop("type"))

        reference_id = d.pop("referenceId")

        _scenario_mappings = d.pop("scenarioMappings", UNSET)
        scenario_mappings: PostApiSuitesByIdRunResponse200ItemsItemTargetScenarioMappings | Unset
        if isinstance(_scenario_mappings, Unset):
            scenario_mappings = UNSET
        else:
            scenario_mappings = PostApiSuitesByIdRunResponse200ItemsItemTargetScenarioMappings.from_dict(
                _scenario_mappings
            )

        _run_parameters = d.pop("runParameters", UNSET)
        run_parameters: PostApiSuitesByIdRunResponse200ItemsItemTargetRunParameters | Unset
        if isinstance(_run_parameters, Unset):
            run_parameters = UNSET
        else:
            run_parameters = PostApiSuitesByIdRunResponse200ItemsItemTargetRunParameters.from_dict(_run_parameters)

        run_secret_parameter_names = cast(list[str], d.pop("runSecretParameterNames", UNSET))

        post_api_suites_by_id_run_response_200_items_item_target = cls(
            type_=type_,
            reference_id=reference_id,
            scenario_mappings=scenario_mappings,
            run_parameters=run_parameters,
            run_secret_parameter_names=run_secret_parameter_names,
        )

        return post_api_suites_by_id_run_response_200_items_item_target
