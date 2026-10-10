from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.create_agent_body_type_3_config_method import CreateAgentBodyType3ConfigMethod
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.create_agent_body_type_3_config_auth_type_0 import CreateAgentBodyType3ConfigAuthType0
    from ..models.create_agent_body_type_3_config_auth_type_1 import CreateAgentBodyType3ConfigAuthType1
    from ..models.create_agent_body_type_3_config_auth_type_2 import CreateAgentBodyType3ConfigAuthType2
    from ..models.create_agent_body_type_3_config_auth_type_3 import CreateAgentBodyType3ConfigAuthType3
    from ..models.create_agent_body_type_3_config_dev_tunnel import CreateAgentBodyType3ConfigDevTunnel
    from ..models.create_agent_body_type_3_config_headers_item import CreateAgentBodyType3ConfigHeadersItem
    from ..models.create_agent_body_type_3_config_inputs_item import CreateAgentBodyType3ConfigInputsItem
    from ..models.create_agent_body_type_3_config_outputs_item import CreateAgentBodyType3ConfigOutputsItem
    from ..models.create_agent_body_type_3_config_parameters_item import CreateAgentBodyType3ConfigParametersItem
    from ..models.create_agent_body_type_3_config_scenario_mappings import CreateAgentBodyType3ConfigScenarioMappings


T = TypeVar("T", bound="CreateAgentBodyType3Config")


@_attrs_define
class CreateAgentBodyType3Config:
    """
    Attributes:
        url (str):
        field_library_ref (str | Unset):
        name (str | Unset):
        description (str | Unset):
        cls (str | Unset):
        parameters (list[CreateAgentBodyType3ConfigParametersItem] | Unset):
        inputs (list[CreateAgentBodyType3ConfigInputsItem] | Unset):
        outputs (list[CreateAgentBodyType3ConfigOutputsItem] | Unset):
        is_custom (bool | Unset):
        behave_as (Literal['evaluator'] | Unset):
        method (CreateAgentBodyType3ConfigMethod | Unset):  Default: CreateAgentBodyType3ConfigMethod.POST.
        headers (list[CreateAgentBodyType3ConfigHeadersItem] | Unset):
        auth (CreateAgentBodyType3ConfigAuthType0 | CreateAgentBodyType3ConfigAuthType1 |
            CreateAgentBodyType3ConfigAuthType2 | CreateAgentBodyType3ConfigAuthType3 | Unset):
        body_template (str | Unset):
        output_path (str | Unset):
        session_path (str | Unset):
        timeout_ms (float | Unset):
        scenario_mappings (CreateAgentBodyType3ConfigScenarioMappings | Unset):
        dev_tunnel (CreateAgentBodyType3ConfigDevTunnel | Unset):
    """

    url: str
    field_library_ref: str | Unset = UNSET
    name: str | Unset = UNSET
    description: str | Unset = UNSET
    cls: str | Unset = UNSET
    parameters: list[CreateAgentBodyType3ConfigParametersItem] | Unset = UNSET
    inputs: list[CreateAgentBodyType3ConfigInputsItem] | Unset = UNSET
    outputs: list[CreateAgentBodyType3ConfigOutputsItem] | Unset = UNSET
    is_custom: bool | Unset = UNSET
    behave_as: Literal["evaluator"] | Unset = UNSET
    method: CreateAgentBodyType3ConfigMethod | Unset = CreateAgentBodyType3ConfigMethod.POST
    headers: list[CreateAgentBodyType3ConfigHeadersItem] | Unset = UNSET
    auth: (
        CreateAgentBodyType3ConfigAuthType0
        | CreateAgentBodyType3ConfigAuthType1
        | CreateAgentBodyType3ConfigAuthType2
        | CreateAgentBodyType3ConfigAuthType3
        | Unset
    ) = UNSET
    body_template: str | Unset = UNSET
    output_path: str | Unset = UNSET
    session_path: str | Unset = UNSET
    timeout_ms: float | Unset = UNSET
    scenario_mappings: CreateAgentBodyType3ConfigScenarioMappings | Unset = UNSET
    dev_tunnel: CreateAgentBodyType3ConfigDevTunnel | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.create_agent_body_type_3_config_auth_type_0 import CreateAgentBodyType3ConfigAuthType0
        from ..models.create_agent_body_type_3_config_auth_type_1 import CreateAgentBodyType3ConfigAuthType1
        from ..models.create_agent_body_type_3_config_auth_type_2 import CreateAgentBodyType3ConfigAuthType2

        url = self.url

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

        method: str | Unset = UNSET
        if not isinstance(self.method, Unset):
            method = self.method.value

        headers: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.headers, Unset):
            headers = []
            for headers_item_data in self.headers:
                headers_item = headers_item_data.to_dict()
                headers.append(headers_item)

        auth: dict[str, Any] | Unset
        if isinstance(self.auth, Unset):
            auth = UNSET
        elif isinstance(self.auth, CreateAgentBodyType3ConfigAuthType0):
            auth = self.auth.to_dict()
        elif isinstance(self.auth, CreateAgentBodyType3ConfigAuthType1):
            auth = self.auth.to_dict()
        elif isinstance(self.auth, CreateAgentBodyType3ConfigAuthType2):
            auth = self.auth.to_dict()
        else:
            auth = self.auth.to_dict()

        body_template = self.body_template

        output_path = self.output_path

        session_path = self.session_path

        timeout_ms = self.timeout_ms

        scenario_mappings: dict[str, Any] | Unset = UNSET
        if not isinstance(self.scenario_mappings, Unset):
            scenario_mappings = self.scenario_mappings.to_dict()

        dev_tunnel: dict[str, Any] | Unset = UNSET
        if not isinstance(self.dev_tunnel, Unset):
            dev_tunnel = self.dev_tunnel.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "url": url,
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
        if method is not UNSET:
            field_dict["method"] = method
        if headers is not UNSET:
            field_dict["headers"] = headers
        if auth is not UNSET:
            field_dict["auth"] = auth
        if body_template is not UNSET:
            field_dict["bodyTemplate"] = body_template
        if output_path is not UNSET:
            field_dict["outputPath"] = output_path
        if session_path is not UNSET:
            field_dict["sessionPath"] = session_path
        if timeout_ms is not UNSET:
            field_dict["timeoutMs"] = timeout_ms
        if scenario_mappings is not UNSET:
            field_dict["scenarioMappings"] = scenario_mappings
        if dev_tunnel is not UNSET:
            field_dict["devTunnel"] = dev_tunnel

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_agent_body_type_3_config_auth_type_0 import CreateAgentBodyType3ConfigAuthType0
        from ..models.create_agent_body_type_3_config_auth_type_1 import CreateAgentBodyType3ConfigAuthType1
        from ..models.create_agent_body_type_3_config_auth_type_2 import CreateAgentBodyType3ConfigAuthType2
        from ..models.create_agent_body_type_3_config_auth_type_3 import CreateAgentBodyType3ConfigAuthType3
        from ..models.create_agent_body_type_3_config_dev_tunnel import CreateAgentBodyType3ConfigDevTunnel
        from ..models.create_agent_body_type_3_config_headers_item import CreateAgentBodyType3ConfigHeadersItem
        from ..models.create_agent_body_type_3_config_inputs_item import CreateAgentBodyType3ConfigInputsItem
        from ..models.create_agent_body_type_3_config_outputs_item import CreateAgentBodyType3ConfigOutputsItem
        from ..models.create_agent_body_type_3_config_parameters_item import CreateAgentBodyType3ConfigParametersItem
        from ..models.create_agent_body_type_3_config_scenario_mappings import (
            CreateAgentBodyType3ConfigScenarioMappings,
        )

        d = dict(src_dict)
        url = d.pop("url")

        field_library_ref = d.pop("_library_ref", UNSET)

        name = d.pop("name", UNSET)

        description = d.pop("description", UNSET)

        cls = d.pop("cls", UNSET)

        _parameters = d.pop("parameters", UNSET)
        parameters: list[CreateAgentBodyType3ConfigParametersItem] | Unset = UNSET
        if _parameters is not UNSET:
            parameters = []
            for parameters_item_data in _parameters:
                parameters_item = CreateAgentBodyType3ConfigParametersItem.from_dict(parameters_item_data)

                parameters.append(parameters_item)

        _inputs = d.pop("inputs", UNSET)
        inputs: list[CreateAgentBodyType3ConfigInputsItem] | Unset = UNSET
        if _inputs is not UNSET:
            inputs = []
            for inputs_item_data in _inputs:
                inputs_item = CreateAgentBodyType3ConfigInputsItem.from_dict(inputs_item_data)

                inputs.append(inputs_item)

        _outputs = d.pop("outputs", UNSET)
        outputs: list[CreateAgentBodyType3ConfigOutputsItem] | Unset = UNSET
        if _outputs is not UNSET:
            outputs = []
            for outputs_item_data in _outputs:
                outputs_item = CreateAgentBodyType3ConfigOutputsItem.from_dict(outputs_item_data)

                outputs.append(outputs_item)

        is_custom = d.pop("isCustom", UNSET)

        behave_as = cast(Literal["evaluator"] | Unset, d.pop("behave_as", UNSET))
        if behave_as != "evaluator" and not isinstance(behave_as, Unset):
            raise ValueError(f"behave_as must match const 'evaluator', got '{behave_as}'")

        _method = d.pop("method", UNSET)
        method: CreateAgentBodyType3ConfigMethod | Unset
        if isinstance(_method, Unset):
            method = UNSET
        else:
            method = CreateAgentBodyType3ConfigMethod(_method)

        _headers = d.pop("headers", UNSET)
        headers: list[CreateAgentBodyType3ConfigHeadersItem] | Unset = UNSET
        if _headers is not UNSET:
            headers = []
            for headers_item_data in _headers:
                headers_item = CreateAgentBodyType3ConfigHeadersItem.from_dict(headers_item_data)

                headers.append(headers_item)

        def _parse_auth(
            data: object,
        ) -> (
            CreateAgentBodyType3ConfigAuthType0
            | CreateAgentBodyType3ConfigAuthType1
            | CreateAgentBodyType3ConfigAuthType2
            | CreateAgentBodyType3ConfigAuthType3
            | Unset
        ):
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                auth_type_0 = CreateAgentBodyType3ConfigAuthType0.from_dict(data)

                return auth_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                auth_type_1 = CreateAgentBodyType3ConfigAuthType1.from_dict(data)

                return auth_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                auth_type_2 = CreateAgentBodyType3ConfigAuthType2.from_dict(data)

                return auth_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            auth_type_3 = CreateAgentBodyType3ConfigAuthType3.from_dict(data)

            return auth_type_3

        auth = _parse_auth(d.pop("auth", UNSET))

        body_template = d.pop("bodyTemplate", UNSET)

        output_path = d.pop("outputPath", UNSET)

        session_path = d.pop("sessionPath", UNSET)

        timeout_ms = d.pop("timeoutMs", UNSET)

        _scenario_mappings = d.pop("scenarioMappings", UNSET)
        scenario_mappings: CreateAgentBodyType3ConfigScenarioMappings | Unset
        if isinstance(_scenario_mappings, Unset):
            scenario_mappings = UNSET
        else:
            scenario_mappings = CreateAgentBodyType3ConfigScenarioMappings.from_dict(_scenario_mappings)

        _dev_tunnel = d.pop("devTunnel", UNSET)
        dev_tunnel: CreateAgentBodyType3ConfigDevTunnel | Unset
        if isinstance(_dev_tunnel, Unset):
            dev_tunnel = UNSET
        else:
            dev_tunnel = CreateAgentBodyType3ConfigDevTunnel.from_dict(_dev_tunnel)

        create_agent_body_type_3_config = cls(
            url=url,
            field_library_ref=field_library_ref,
            name=name,
            description=description,
            cls=cls,
            parameters=parameters,
            inputs=inputs,
            outputs=outputs,
            is_custom=is_custom,
            behave_as=behave_as,
            method=method,
            headers=headers,
            auth=auth,
            body_template=body_template,
            output_path=output_path,
            session_path=session_path,
            timeout_ms=timeout_ms,
            scenario_mappings=scenario_mappings,
            dev_tunnel=dev_tunnel,
        )

        create_agent_body_type_3_config.additional_properties = d
        return create_agent_body_type_3_config

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
