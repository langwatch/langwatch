from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.create_agent_body_type_1_config_inputs_item import CreateAgentBodyType1ConfigInputsItem
    from ..models.create_agent_body_type_1_config_outputs_item import CreateAgentBodyType1ConfigOutputsItem
    from ..models.create_agent_body_type_1_config_parameters_item_type_0 import (
        CreateAgentBodyType1ConfigParametersItemType0,
    )
    from ..models.create_agent_body_type_1_config_parameters_item_type_1 import (
        CreateAgentBodyType1ConfigParametersItemType1,
    )
    from ..models.create_agent_body_type_1_config_scenario_mappings import CreateAgentBodyType1ConfigScenarioMappings


T = TypeVar("T", bound="CreateAgentBodyType1Config")


@_attrs_define
class CreateAgentBodyType1Config:
    """
    Attributes:
        parameters (list[CreateAgentBodyType1ConfigParametersItemType0 |
            CreateAgentBodyType1ConfigParametersItemType1]):
        field_library_ref (str | Unset):
        name (str | Unset):
        description (str | Unset):
        cls (str | Unset):
        inputs (list[CreateAgentBodyType1ConfigInputsItem] | Unset):
        outputs (list[CreateAgentBodyType1ConfigOutputsItem] | Unset):
        is_custom (bool | Unset):
        behave_as (Literal['evaluator'] | Unset):
        scenario_mappings (CreateAgentBodyType1ConfigScenarioMappings | Unset):
        scenario_output_field (str | Unset):
    """

    parameters: list[CreateAgentBodyType1ConfigParametersItemType0 | CreateAgentBodyType1ConfigParametersItemType1]
    field_library_ref: str | Unset = UNSET
    name: str | Unset = UNSET
    description: str | Unset = UNSET
    cls: str | Unset = UNSET
    inputs: list[CreateAgentBodyType1ConfigInputsItem] | Unset = UNSET
    outputs: list[CreateAgentBodyType1ConfigOutputsItem] | Unset = UNSET
    is_custom: bool | Unset = UNSET
    behave_as: Literal["evaluator"] | Unset = UNSET
    scenario_mappings: CreateAgentBodyType1ConfigScenarioMappings | Unset = UNSET
    scenario_output_field: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.create_agent_body_type_1_config_parameters_item_type_0 import (
            CreateAgentBodyType1ConfigParametersItemType0,
        )

        parameters = []
        for parameters_item_data in self.parameters:
            parameters_item: dict[str, Any]
            if isinstance(parameters_item_data, CreateAgentBodyType1ConfigParametersItemType0):
                parameters_item = parameters_item_data.to_dict()
            else:
                parameters_item = parameters_item_data.to_dict()

            parameters.append(parameters_item)

        field_library_ref = self.field_library_ref

        name = self.name

        description = self.description

        cls = self.cls

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

        scenario_mappings: dict[str, Any] | Unset = UNSET
        if not isinstance(self.scenario_mappings, Unset):
            scenario_mappings = self.scenario_mappings.to_dict()

        scenario_output_field = self.scenario_output_field

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "parameters": parameters,
            }
        )
        if field_library_ref is not UNSET:
            field_dict["_library_ref"] = field_library_ref
        if name is not UNSET:
            field_dict["name"] = name
        if description is not UNSET:
            field_dict["description"] = description
        if cls is not UNSET:
            field_dict["cls"] = cls
        if inputs is not UNSET:
            field_dict["inputs"] = inputs
        if outputs is not UNSET:
            field_dict["outputs"] = outputs
        if is_custom is not UNSET:
            field_dict["isCustom"] = is_custom
        if behave_as is not UNSET:
            field_dict["behave_as"] = behave_as
        if scenario_mappings is not UNSET:
            field_dict["scenarioMappings"] = scenario_mappings
        if scenario_output_field is not UNSET:
            field_dict["scenarioOutputField"] = scenario_output_field

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_agent_body_type_1_config_inputs_item import CreateAgentBodyType1ConfigInputsItem
        from ..models.create_agent_body_type_1_config_outputs_item import CreateAgentBodyType1ConfigOutputsItem
        from ..models.create_agent_body_type_1_config_parameters_item_type_0 import (
            CreateAgentBodyType1ConfigParametersItemType0,
        )
        from ..models.create_agent_body_type_1_config_parameters_item_type_1 import (
            CreateAgentBodyType1ConfigParametersItemType1,
        )
        from ..models.create_agent_body_type_1_config_scenario_mappings import (
            CreateAgentBodyType1ConfigScenarioMappings,
        )

        d = dict(src_dict)
        parameters = []
        _parameters = d.pop("parameters")
        for parameters_item_data in _parameters:

            def _parse_parameters_item(
                data: object,
            ) -> CreateAgentBodyType1ConfigParametersItemType0 | CreateAgentBodyType1ConfigParametersItemType1:
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    parameters_item_type_0 = CreateAgentBodyType1ConfigParametersItemType0.from_dict(data)

                    return parameters_item_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                parameters_item_type_1 = CreateAgentBodyType1ConfigParametersItemType1.from_dict(data)

                return parameters_item_type_1

            parameters_item = _parse_parameters_item(parameters_item_data)

            parameters.append(parameters_item)

        field_library_ref = d.pop("_library_ref", UNSET)

        name = d.pop("name", UNSET)

        description = d.pop("description", UNSET)

        cls = d.pop("cls", UNSET)

        _inputs = d.pop("inputs", UNSET)
        inputs: list[CreateAgentBodyType1ConfigInputsItem] | Unset = UNSET
        if _inputs is not UNSET:
            inputs = []
            for inputs_item_data in _inputs:
                inputs_item = CreateAgentBodyType1ConfigInputsItem.from_dict(inputs_item_data)

                inputs.append(inputs_item)

        _outputs = d.pop("outputs", UNSET)
        outputs: list[CreateAgentBodyType1ConfigOutputsItem] | Unset = UNSET
        if _outputs is not UNSET:
            outputs = []
            for outputs_item_data in _outputs:
                outputs_item = CreateAgentBodyType1ConfigOutputsItem.from_dict(outputs_item_data)

                outputs.append(outputs_item)

        is_custom = d.pop("isCustom", UNSET)

        behave_as = cast(Literal["evaluator"] | Unset, d.pop("behave_as", UNSET))
        if behave_as != "evaluator" and not isinstance(behave_as, Unset):
            raise ValueError(f"behave_as must match const 'evaluator', got '{behave_as}'")

        _scenario_mappings = d.pop("scenarioMappings", UNSET)
        scenario_mappings: CreateAgentBodyType1ConfigScenarioMappings | Unset
        if isinstance(_scenario_mappings, Unset):
            scenario_mappings = UNSET
        else:
            scenario_mappings = CreateAgentBodyType1ConfigScenarioMappings.from_dict(_scenario_mappings)

        scenario_output_field = d.pop("scenarioOutputField", UNSET)

        create_agent_body_type_1_config = cls(
            parameters=parameters,
            field_library_ref=field_library_ref,
            name=name,
            description=description,
            cls=cls,
            inputs=inputs,
            outputs=outputs,
            is_custom=is_custom,
            behave_as=behave_as,
            scenario_mappings=scenario_mappings,
            scenario_output_field=scenario_output_field,
        )

        create_agent_body_type_1_config.additional_properties = d
        return create_agent_body_type_1_config

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
