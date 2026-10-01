from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.create_agent_body_type_4_config_inputs_item import CreateAgentBodyType4ConfigInputsItem
    from ..models.create_agent_body_type_4_config_outputs_item import CreateAgentBodyType4ConfigOutputsItem
    from ..models.create_agent_body_type_4_config_parameters_item import CreateAgentBodyType4ConfigParametersItem
    from ..models.create_agent_body_type_4_config_sdk import CreateAgentBodyType4ConfigSdk


T = TypeVar("T", bound="CreateAgentBodyType4Config")


@_attrs_define
class CreateAgentBodyType4Config:
    """
    Attributes:
        sdk (CreateAgentBodyType4ConfigSdk):
        field_library_ref (str | Unset):
        name (str | Unset):
        cls (str | Unset):
        parameters (list[CreateAgentBodyType4ConfigParametersItem] | Unset):
        inputs (list[CreateAgentBodyType4ConfigInputsItem] | Unset):
        outputs (list[CreateAgentBodyType4ConfigOutputsItem] | Unset):
        is_custom (bool | Unset):
        behave_as (Literal['evaluator'] | Unset):
        timeout_ms (int | Unset):
        concurrency (int | Unset):
        sticky (bool | Unset):
    """

    sdk: CreateAgentBodyType4ConfigSdk
    field_library_ref: str | Unset = UNSET
    name: str | Unset = UNSET
    cls: str | Unset = UNSET
    parameters: list[CreateAgentBodyType4ConfigParametersItem] | Unset = UNSET
    inputs: list[CreateAgentBodyType4ConfigInputsItem] | Unset = UNSET
    outputs: list[CreateAgentBodyType4ConfigOutputsItem] | Unset = UNSET
    is_custom: bool | Unset = UNSET
    behave_as: Literal["evaluator"] | Unset = UNSET
    timeout_ms: int | Unset = UNSET
    concurrency: int | Unset = UNSET
    sticky: bool | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        sdk = self.sdk.to_dict()

        field_library_ref = self.field_library_ref

        name = self.name

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

        timeout_ms = self.timeout_ms

        concurrency = self.concurrency

        sticky = self.sticky

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "sdk": sdk,
            }
        )
        if field_library_ref is not UNSET:
            field_dict["_library_ref"] = field_library_ref
        if name is not UNSET:
            field_dict["name"] = name
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
        if timeout_ms is not UNSET:
            field_dict["timeoutMs"] = timeout_ms
        if concurrency is not UNSET:
            field_dict["concurrency"] = concurrency
        if sticky is not UNSET:
            field_dict["sticky"] = sticky

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_agent_body_type_4_config_inputs_item import CreateAgentBodyType4ConfigInputsItem
        from ..models.create_agent_body_type_4_config_outputs_item import CreateAgentBodyType4ConfigOutputsItem
        from ..models.create_agent_body_type_4_config_parameters_item import CreateAgentBodyType4ConfigParametersItem
        from ..models.create_agent_body_type_4_config_sdk import CreateAgentBodyType4ConfigSdk

        d = dict(src_dict)
        sdk = CreateAgentBodyType4ConfigSdk.from_dict(d.pop("sdk"))

        field_library_ref = d.pop("_library_ref", UNSET)

        name = d.pop("name", UNSET)

        cls = d.pop("cls", UNSET)

        _parameters = d.pop("parameters", UNSET)
        parameters: list[CreateAgentBodyType4ConfigParametersItem] | Unset = UNSET
        if _parameters is not UNSET:
            parameters = []
            for parameters_item_data in _parameters:
                parameters_item = CreateAgentBodyType4ConfigParametersItem.from_dict(parameters_item_data)

                parameters.append(parameters_item)

        _inputs = d.pop("inputs", UNSET)
        inputs: list[CreateAgentBodyType4ConfigInputsItem] | Unset = UNSET
        if _inputs is not UNSET:
            inputs = []
            for inputs_item_data in _inputs:
                inputs_item = CreateAgentBodyType4ConfigInputsItem.from_dict(inputs_item_data)

                inputs.append(inputs_item)

        _outputs = d.pop("outputs", UNSET)
        outputs: list[CreateAgentBodyType4ConfigOutputsItem] | Unset = UNSET
        if _outputs is not UNSET:
            outputs = []
            for outputs_item_data in _outputs:
                outputs_item = CreateAgentBodyType4ConfigOutputsItem.from_dict(outputs_item_data)

                outputs.append(outputs_item)

        is_custom = d.pop("isCustom", UNSET)

        behave_as = cast(Literal["evaluator"] | Unset, d.pop("behave_as", UNSET))
        if behave_as != "evaluator" and not isinstance(behave_as, Unset):
            raise ValueError(f"behave_as must match const 'evaluator', got '{behave_as}'")

        timeout_ms = d.pop("timeoutMs", UNSET)

        concurrency = d.pop("concurrency", UNSET)

        sticky = d.pop("sticky", UNSET)

        create_agent_body_type_4_config = cls(
            sdk=sdk,
            field_library_ref=field_library_ref,
            name=name,
            cls=cls,
            parameters=parameters,
            inputs=inputs,
            outputs=outputs,
            is_custom=is_custom,
            behave_as=behave_as,
            timeout_ms=timeout_ms,
            concurrency=concurrency,
            sticky=sticky,
        )

        create_agent_body_type_4_config.additional_properties = d
        return create_agent_body_type_4_config

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
