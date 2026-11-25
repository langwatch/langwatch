from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.create_agent_body_type_0_config_inputs_item import CreateAgentBodyType0ConfigInputsItem
    from ..models.create_agent_body_type_0_config_llm import CreateAgentBodyType0ConfigLlm
    from ..models.create_agent_body_type_0_config_messages_item import CreateAgentBodyType0ConfigMessagesItem
    from ..models.create_agent_body_type_0_config_outputs_item import CreateAgentBodyType0ConfigOutputsItem
    from ..models.create_agent_body_type_0_config_parameters_item import CreateAgentBodyType0ConfigParametersItem
    from ..models.create_agent_body_type_0_config_version_metadata import CreateAgentBodyType0ConfigVersionMetadata


T = TypeVar("T", bound="CreateAgentBodyType0Config")


@_attrs_define
class CreateAgentBodyType0Config:
    """
    Attributes:
        field_library_ref (str | Unset):
        name (str | Unset):
        description (str | Unset):
        cls (str | Unset):
        parameters (list[CreateAgentBodyType0ConfigParametersItem] | Unset):
        inputs (list[CreateAgentBodyType0ConfigInputsItem] | Unset):
        outputs (list[CreateAgentBodyType0ConfigOutputsItem] | Unset):
        is_custom (bool | Unset):
        behave_as (Literal['evaluator'] | Unset):
        config_id (str | Unset):
        handle (None | str | Unset):
        version_metadata (CreateAgentBodyType0ConfigVersionMetadata | Unset):
        llm (CreateAgentBodyType0ConfigLlm | Unset):
        prompt (str | Unset):
        messages (list[CreateAgentBodyType0ConfigMessagesItem] | Unset):
        prompt_draft (bool | Unset):
    """

    field_library_ref: str | Unset = UNSET
    name: str | Unset = UNSET
    description: str | Unset = UNSET
    cls: str | Unset = UNSET
    parameters: list[CreateAgentBodyType0ConfigParametersItem] | Unset = UNSET
    inputs: list[CreateAgentBodyType0ConfigInputsItem] | Unset = UNSET
    outputs: list[CreateAgentBodyType0ConfigOutputsItem] | Unset = UNSET
    is_custom: bool | Unset = UNSET
    behave_as: Literal["evaluator"] | Unset = UNSET
    config_id: str | Unset = UNSET
    handle: None | str | Unset = UNSET
    version_metadata: CreateAgentBodyType0ConfigVersionMetadata | Unset = UNSET
    llm: CreateAgentBodyType0ConfigLlm | Unset = UNSET
    prompt: str | Unset = UNSET
    messages: list[CreateAgentBodyType0ConfigMessagesItem] | Unset = UNSET
    prompt_draft: bool | Unset = UNSET
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

        config_id = self.config_id

        handle: None | str | Unset
        if isinstance(self.handle, Unset):
            handle = UNSET
        else:
            handle = self.handle

        version_metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.version_metadata, Unset):
            version_metadata = self.version_metadata.to_dict()

        llm: dict[str, Any] | Unset = UNSET
        if not isinstance(self.llm, Unset):
            llm = self.llm.to_dict()

        prompt = self.prompt

        messages: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.messages, Unset):
            messages = []
            for messages_item_data in self.messages:
                messages_item = messages_item_data.to_dict()
                messages.append(messages_item)

        prompt_draft = self.prompt_draft

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
        if config_id is not UNSET:
            field_dict["configId"] = config_id
        if handle is not UNSET:
            field_dict["handle"] = handle
        if version_metadata is not UNSET:
            field_dict["versionMetadata"] = version_metadata
        if llm is not UNSET:
            field_dict["llm"] = llm
        if prompt is not UNSET:
            field_dict["prompt"] = prompt
        if messages is not UNSET:
            field_dict["messages"] = messages
        if prompt_draft is not UNSET:
            field_dict["promptDraft"] = prompt_draft

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_agent_body_type_0_config_inputs_item import CreateAgentBodyType0ConfigInputsItem
        from ..models.create_agent_body_type_0_config_llm import CreateAgentBodyType0ConfigLlm
        from ..models.create_agent_body_type_0_config_messages_item import CreateAgentBodyType0ConfigMessagesItem
        from ..models.create_agent_body_type_0_config_outputs_item import CreateAgentBodyType0ConfigOutputsItem
        from ..models.create_agent_body_type_0_config_parameters_item import CreateAgentBodyType0ConfigParametersItem
        from ..models.create_agent_body_type_0_config_version_metadata import CreateAgentBodyType0ConfigVersionMetadata

        d = dict(src_dict)
        field_library_ref = d.pop("_library_ref", UNSET)

        name = d.pop("name", UNSET)

        description = d.pop("description", UNSET)

        cls = d.pop("cls", UNSET)

        _parameters = d.pop("parameters", UNSET)
        parameters: list[CreateAgentBodyType0ConfigParametersItem] | Unset = UNSET
        if _parameters is not UNSET:
            parameters = []
            for parameters_item_data in _parameters:
                parameters_item = CreateAgentBodyType0ConfigParametersItem.from_dict(parameters_item_data)

                parameters.append(parameters_item)

        _inputs = d.pop("inputs", UNSET)
        inputs: list[CreateAgentBodyType0ConfigInputsItem] | Unset = UNSET
        if _inputs is not UNSET:
            inputs = []
            for inputs_item_data in _inputs:
                inputs_item = CreateAgentBodyType0ConfigInputsItem.from_dict(inputs_item_data)

                inputs.append(inputs_item)

        _outputs = d.pop("outputs", UNSET)
        outputs: list[CreateAgentBodyType0ConfigOutputsItem] | Unset = UNSET
        if _outputs is not UNSET:
            outputs = []
            for outputs_item_data in _outputs:
                outputs_item = CreateAgentBodyType0ConfigOutputsItem.from_dict(outputs_item_data)

                outputs.append(outputs_item)

        is_custom = d.pop("isCustom", UNSET)

        behave_as = cast(Literal["evaluator"] | Unset, d.pop("behave_as", UNSET))
        if behave_as != "evaluator" and not isinstance(behave_as, Unset):
            raise ValueError(f"behave_as must match const 'evaluator', got '{behave_as}'")

        config_id = d.pop("configId", UNSET)

        def _parse_handle(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        handle = _parse_handle(d.pop("handle", UNSET))

        _version_metadata = d.pop("versionMetadata", UNSET)
        version_metadata: CreateAgentBodyType0ConfigVersionMetadata | Unset
        if isinstance(_version_metadata, Unset):
            version_metadata = UNSET
        else:
            version_metadata = CreateAgentBodyType0ConfigVersionMetadata.from_dict(_version_metadata)

        _llm = d.pop("llm", UNSET)
        llm: CreateAgentBodyType0ConfigLlm | Unset
        if isinstance(_llm, Unset):
            llm = UNSET
        else:
            llm = CreateAgentBodyType0ConfigLlm.from_dict(_llm)

        prompt = d.pop("prompt", UNSET)

        _messages = d.pop("messages", UNSET)
        messages: list[CreateAgentBodyType0ConfigMessagesItem] | Unset = UNSET
        if _messages is not UNSET:
            messages = []
            for messages_item_data in _messages:
                messages_item = CreateAgentBodyType0ConfigMessagesItem.from_dict(messages_item_data)

                messages.append(messages_item)

        prompt_draft = d.pop("promptDraft", UNSET)

        create_agent_body_type_0_config = cls(
            field_library_ref=field_library_ref,
            name=name,
            description=description,
            cls=cls,
            parameters=parameters,
            inputs=inputs,
            outputs=outputs,
            is_custom=is_custom,
            behave_as=behave_as,
            config_id=config_id,
            handle=handle,
            version_metadata=version_metadata,
            llm=llm,
            prompt=prompt,
            messages=messages,
            prompt_draft=prompt_draft,
        )

        create_agent_body_type_0_config.additional_properties = d
        return create_agent_body_type_0_config

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
