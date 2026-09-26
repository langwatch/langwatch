from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.create_agent_body_type_2_config_inputs_item import CreateAgentBodyType2ConfigInputsItem
    from ..models.create_agent_body_type_2_config_outputs_item import CreateAgentBodyType2ConfigOutputsItem
    from ..models.create_agent_body_type_2_config_parameters_item import CreateAgentBodyType2ConfigParametersItem
    from ..models.create_agent_body_type_2_config_scenario_mappings import CreateAgentBodyType2ConfigScenarioMappings
    from ..models.create_agent_body_type_2_config_versions import CreateAgentBodyType2ConfigVersions


T = TypeVar("T", bound="CreateAgentBodyType2Config")


@_attrs_define
class CreateAgentBodyType2Config:
    """
    Attributes:
        field_library_ref (str | Unset):
        name (str | Unset):
        description (str | Unset):
        cls (str | Unset):
        parameters (list[CreateAgentBodyType2ConfigParametersItem] | Unset):
        inputs (list[CreateAgentBodyType2ConfigInputsItem] | Unset):
        outputs (list[CreateAgentBodyType2ConfigOutputsItem] | Unset):
        is_custom (bool | Unset):
        behave_as (Literal['evaluator'] | Unset):
        workflow_id (str | Unset):
        published_id (str | Unset):
        version_id (str | Unset):
        versions (CreateAgentBodyType2ConfigVersions | Unset):
        scenario_mappings (CreateAgentBodyType2ConfigScenarioMappings | Unset):
        scenario_output_field (str | Unset):
    """

    field_library_ref: str | Unset = UNSET
    name: str | Unset = UNSET
    description: str | Unset = UNSET
    cls: str | Unset = UNSET
    parameters: list[CreateAgentBodyType2ConfigParametersItem] | Unset = UNSET
    inputs: list[CreateAgentBodyType2ConfigInputsItem] | Unset = UNSET
    outputs: list[CreateAgentBodyType2ConfigOutputsItem] | Unset = UNSET
    is_custom: bool | Unset = UNSET
    behave_as: Literal["evaluator"] | Unset = UNSET
    workflow_id: str | Unset = UNSET
    published_id: str | Unset = UNSET
    version_id: str | Unset = UNSET
    versions: CreateAgentBodyType2ConfigVersions | Unset = UNSET
    scenario_mappings: CreateAgentBodyType2ConfigScenarioMappings | Unset = UNSET
    scenario_output_field: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        field_library_ref = self.field_library_ref

        name = self.name

        description = self.description

        cls = self.cls

        parameters: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.parameters, Unset):
            parameters = []
            for parameters_item_data in self.parameters:
                parameters_item = parameters_item_data.to_dict()
                parameters.append(parameters_item)

        inputs: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.inputs, Unset):
            inputs = []
            for inputs_item_data in self.inputs:
                inputs_item = inputs_item_data.to_dict()
                inputs.append(inputs_item)

        outputs: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.outputs, Unset):
            outputs = []
            for outputs_item_data in self.outputs:
                outputs_item = outputs_item_data.to_dict()
                outputs.append(outputs_item)

        is_custom = self.is_custom

        behave_as = self.behave_as

        workflow_id = self.workflow_id

        published_id = self.published_id

        version_id = self.version_id

        versions: dict[str, Any] | Unset = UNSET
        if not isinstance(self.versions, Unset):
            versions = self.versions.to_dict()

        scenario_mappings: dict[str, Any] | Unset = UNSET
        if not isinstance(self.scenario_mappings, Unset):
            scenario_mappings = self.scenario_mappings.to_dict()

        scenario_output_field = self.scenario_output_field

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if field_library_ref is not UNSET:
            field_dict["_library_ref"] = field_library_ref
        if name is not UNSET:
            field_dict["name"] = name
        if description is not UNSET:
            field_dict["description"] = description
        if cls is not UNSET:
            field_dict["cls"] = cls
        if parameters is not UNSET:
            field_dict["parameters"] = parameters
        if inputs is not UNSET:
            field_dict["inputs"] = inputs
        if outputs is not UNSET:
            field_dict["outputs"] = outputs
        if is_custom is not UNSET:
            field_dict["isCustom"] = is_custom
        if behave_as is not UNSET:
            field_dict["behave_as"] = behave_as
        if workflow_id is not UNSET:
            field_dict["workflow_id"] = workflow_id
        if published_id is not UNSET:
            field_dict["publishedId"] = published_id
        if version_id is not UNSET:
            field_dict["version_id"] = version_id
        if versions is not UNSET:
            field_dict["versions"] = versions
        if scenario_mappings is not UNSET:
            field_dict["scenarioMappings"] = scenario_mappings
        if scenario_output_field is not UNSET:
            field_dict["scenarioOutputField"] = scenario_output_field

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_agent_body_type_2_config_inputs_item import CreateAgentBodyType2ConfigInputsItem
        from ..models.create_agent_body_type_2_config_outputs_item import CreateAgentBodyType2ConfigOutputsItem
        from ..models.create_agent_body_type_2_config_parameters_item import CreateAgentBodyType2ConfigParametersItem
        from ..models.create_agent_body_type_2_config_scenario_mappings import (
            CreateAgentBodyType2ConfigScenarioMappings,
        )
        from ..models.create_agent_body_type_2_config_versions import CreateAgentBodyType2ConfigVersions

        d = dict(src_dict)
        field_library_ref = d.pop("_library_ref", UNSET)

        name = d.pop("name", UNSET)

        description = d.pop("description", UNSET)

        cls = d.pop("cls", UNSET)

        _parameters = d.pop("parameters", UNSET)
        parameters: list[CreateAgentBodyType2ConfigParametersItem] | Unset = UNSET
        if _parameters is not UNSET:
            parameters = []
            for parameters_item_data in _parameters:
                parameters_item = CreateAgentBodyType2ConfigParametersItem.from_dict(parameters_item_data)

                parameters.append(parameters_item)

        _inputs = d.pop("inputs", UNSET)
        inputs: list[CreateAgentBodyType2ConfigInputsItem] | Unset = UNSET
        if _inputs is not UNSET:
            inputs = []
            for inputs_item_data in _inputs:
                inputs_item = CreateAgentBodyType2ConfigInputsItem.from_dict(inputs_item_data)

                inputs.append(inputs_item)

        _outputs = d.pop("outputs", UNSET)
        outputs: list[CreateAgentBodyType2ConfigOutputsItem] | Unset = UNSET
        if _outputs is not UNSET:
            outputs = []
            for outputs_item_data in _outputs:
                outputs_item = CreateAgentBodyType2ConfigOutputsItem.from_dict(outputs_item_data)

                outputs.append(outputs_item)

        is_custom = d.pop("isCustom", UNSET)

        behave_as = cast(Literal["evaluator"] | Unset, d.pop("behave_as", UNSET))
        if behave_as != "evaluator" and not isinstance(behave_as, Unset):
            raise ValueError(f"behave_as must match const 'evaluator', got '{behave_as}'")

        workflow_id = d.pop("workflow_id", UNSET)

        published_id = d.pop("publishedId", UNSET)

        version_id = d.pop("version_id", UNSET)

        _versions = d.pop("versions", UNSET)
        versions: CreateAgentBodyType2ConfigVersions | Unset
        if isinstance(_versions, Unset):
            versions = UNSET
        else:
            versions = CreateAgentBodyType2ConfigVersions.from_dict(_versions)

        _scenario_mappings = d.pop("scenarioMappings", UNSET)
        scenario_mappings: CreateAgentBodyType2ConfigScenarioMappings | Unset
        if isinstance(_scenario_mappings, Unset):
            scenario_mappings = UNSET
        else:
            scenario_mappings = CreateAgentBodyType2ConfigScenarioMappings.from_dict(_scenario_mappings)

        scenario_output_field = d.pop("scenarioOutputField", UNSET)

        create_agent_body_type_2_config = cls(
            field_library_ref=field_library_ref,
            name=name,
            description=description,
            cls=cls,
            parameters=parameters,
            inputs=inputs,
            outputs=outputs,
            is_custom=is_custom,
            behave_as=behave_as,
            workflow_id=workflow_id,
            published_id=published_id,
            version_id=version_id,
            versions=versions,
            scenario_mappings=scenario_mappings,
            scenario_output_field=scenario_output_field,
        )

        create_agent_body_type_2_config.additional_properties = d
        return create_agent_body_type_2_config

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
