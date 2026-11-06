from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.create_agent_body_type_6_config_call import CreateAgentBodyType6ConfigCall
    from ..models.create_agent_body_type_6_config_inputs_item import CreateAgentBodyType6ConfigInputsItem
    from ..models.create_agent_body_type_6_config_outputs_item import CreateAgentBodyType6ConfigOutputsItem
    from ..models.create_agent_body_type_6_config_parameters_item import CreateAgentBodyType6ConfigParametersItem
    from ..models.create_agent_body_type_6_config_setup import CreateAgentBodyType6ConfigSetup
    from ..models.create_agent_body_type_6_config_teardown import CreateAgentBodyType6ConfigTeardown


T = TypeVar("T", bound="CreateAgentBodyType6Config")


@_attrs_define
class CreateAgentBodyType6Config:
    """
    Attributes:
        call (CreateAgentBodyType6ConfigCall):
        field_library_ref (str | Unset):
        name (str | Unset):
        description (str | Unset):
        cls (str | Unset):
        parameters (list[CreateAgentBodyType6ConfigParametersItem] | Unset):
        inputs (list[CreateAgentBodyType6ConfigInputsItem] | Unset):
        outputs (list[CreateAgentBodyType6ConfigOutputsItem] | Unset):
        is_custom (bool | Unset):
        behave_as (Literal['evaluator'] | Unset):
        setup (CreateAgentBodyType6ConfigSetup | Unset):
        teardown (CreateAgentBodyType6ConfigTeardown | Unset):
        secret_names (list[str] | Unset):
        fixtures_dataset_id (str | Unset):
        timeout_ms (int | Unset):
    """

    call: CreateAgentBodyType6ConfigCall
    field_library_ref: str | Unset = UNSET
    name: str | Unset = UNSET
    description: str | Unset = UNSET
    cls: str | Unset = UNSET
    parameters: list[CreateAgentBodyType6ConfigParametersItem] | Unset = UNSET
    inputs: list[CreateAgentBodyType6ConfigInputsItem] | Unset = UNSET
    outputs: list[CreateAgentBodyType6ConfigOutputsItem] | Unset = UNSET
    is_custom: bool | Unset = UNSET
    behave_as: Literal["evaluator"] | Unset = UNSET
    setup: CreateAgentBodyType6ConfigSetup | Unset = UNSET
    teardown: CreateAgentBodyType6ConfigTeardown | Unset = UNSET
    secret_names: list[str] | Unset = UNSET
    fixtures_dataset_id: str | Unset = UNSET
    timeout_ms: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        call = self.call.to_dict()

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

        setup: dict[str, Any] | Unset = UNSET
        if not isinstance(self.setup, Unset):
            setup = self.setup.to_dict()

        teardown: dict[str, Any] | Unset = UNSET
        if not isinstance(self.teardown, Unset):
            teardown = self.teardown.to_dict()

        secret_names: list[str] | Unset = UNSET
        if not isinstance(self.secret_names, Unset):
            secret_names = self.secret_names

        fixtures_dataset_id = self.fixtures_dataset_id

        timeout_ms = self.timeout_ms

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "call": call,
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
        if setup is not UNSET:
            field_dict["setup"] = setup
        if teardown is not UNSET:
            field_dict["teardown"] = teardown
        if secret_names is not UNSET:
            field_dict["secretNames"] = secret_names
        if fixtures_dataset_id is not UNSET:
            field_dict["fixturesDatasetId"] = fixtures_dataset_id
        if timeout_ms is not UNSET:
            field_dict["timeoutMs"] = timeout_ms

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_agent_body_type_6_config_call import CreateAgentBodyType6ConfigCall
        from ..models.create_agent_body_type_6_config_inputs_item import CreateAgentBodyType6ConfigInputsItem
        from ..models.create_agent_body_type_6_config_outputs_item import CreateAgentBodyType6ConfigOutputsItem
        from ..models.create_agent_body_type_6_config_parameters_item import CreateAgentBodyType6ConfigParametersItem
        from ..models.create_agent_body_type_6_config_setup import CreateAgentBodyType6ConfigSetup
        from ..models.create_agent_body_type_6_config_teardown import CreateAgentBodyType6ConfigTeardown

        d = dict(src_dict)
        call = CreateAgentBodyType6ConfigCall.from_dict(d.pop("call"))

        field_library_ref = d.pop("_library_ref", UNSET)

        name = d.pop("name", UNSET)

        description = d.pop("description", UNSET)

        cls = d.pop("cls", UNSET)

        _parameters = d.pop("parameters", UNSET)
        parameters: list[CreateAgentBodyType6ConfigParametersItem] | Unset = UNSET
        if _parameters is not UNSET:
            parameters = []
            for parameters_item_data in _parameters:
                parameters_item = CreateAgentBodyType6ConfigParametersItem.from_dict(parameters_item_data)

                parameters.append(parameters_item)

        _inputs = d.pop("inputs", UNSET)
        inputs: list[CreateAgentBodyType6ConfigInputsItem] | Unset = UNSET
        if _inputs is not UNSET:
            inputs = []
            for inputs_item_data in _inputs:
                inputs_item = CreateAgentBodyType6ConfigInputsItem.from_dict(inputs_item_data)

                inputs.append(inputs_item)

        _outputs = d.pop("outputs", UNSET)
        outputs: list[CreateAgentBodyType6ConfigOutputsItem] | Unset = UNSET
        if _outputs is not UNSET:
            outputs = []
            for outputs_item_data in _outputs:
                outputs_item = CreateAgentBodyType6ConfigOutputsItem.from_dict(outputs_item_data)

                outputs.append(outputs_item)

        is_custom = d.pop("isCustom", UNSET)

        behave_as = cast(Literal["evaluator"] | Unset, d.pop("behave_as", UNSET))
        if behave_as != "evaluator" and not isinstance(behave_as, Unset):
            raise ValueError(f"behave_as must match const 'evaluator', got '{behave_as}'")

        _setup = d.pop("setup", UNSET)
        setup: CreateAgentBodyType6ConfigSetup | Unset
        if isinstance(_setup, Unset):
            setup = UNSET
        else:
            setup = CreateAgentBodyType6ConfigSetup.from_dict(_setup)

        _teardown = d.pop("teardown", UNSET)
        teardown: CreateAgentBodyType6ConfigTeardown | Unset
        if isinstance(_teardown, Unset):
            teardown = UNSET
        else:
            teardown = CreateAgentBodyType6ConfigTeardown.from_dict(_teardown)

        secret_names = cast(list[str], d.pop("secretNames", UNSET))

        fixtures_dataset_id = d.pop("fixturesDatasetId", UNSET)

        timeout_ms = d.pop("timeoutMs", UNSET)

        create_agent_body_type_6_config = cls(
            call=call,
            field_library_ref=field_library_ref,
            name=name,
            description=description,
            cls=cls,
            parameters=parameters,
            inputs=inputs,
            outputs=outputs,
            is_custom=is_custom,
            behave_as=behave_as,
            setup=setup,
            teardown=teardown,
            secret_names=secret_names,
            fixtures_dataset_id=fixtures_dataset_id,
            timeout_ms=timeout_ms,
        )

        create_agent_body_type_6_config.additional_properties = d
        return create_agent_body_type_6_config

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
