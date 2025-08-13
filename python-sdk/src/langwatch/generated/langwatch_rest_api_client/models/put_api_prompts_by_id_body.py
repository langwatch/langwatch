from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.put_api_prompts_by_id_body_schema_version import PutApiPromptsByIdBodySchemaVersion
from ..models.put_api_prompts_by_id_body_scope import PutApiPromptsByIdBodyScope
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.put_api_prompts_by_id_body_inputs_item import PutApiPromptsByIdBodyInputsItem
    from ..models.put_api_prompts_by_id_body_messages_item import PutApiPromptsByIdBodyMessagesItem
    from ..models.put_api_prompts_by_id_body_outputs_item import PutApiPromptsByIdBodyOutputsItem


T = TypeVar("T", bound="PutApiPromptsByIdBody")


@_attrs_define
class PutApiPromptsByIdBody:
    """
    Attributes:
        handle (Union[Unset, str]):
        model (Union[Unset, str]):
        temperature (Union[Unset, float]):
        max_tokens (Union[Unset, float]):
        commit_message (Union[Unset, str]):
        author_id (Union[Unset, str]):
        prompt (Union[Unset, str]):
        messages (Union[Unset, list['PutApiPromptsByIdBodyMessagesItem']]):
        inputs (Union[Unset, list['PutApiPromptsByIdBodyInputsItem']]):
        outputs (Union[Unset, list['PutApiPromptsByIdBodyOutputsItem']]):
        schema_version (Union[Unset, PutApiPromptsByIdBodySchemaVersion]):
        scope (Union[Unset, PutApiPromptsByIdBodyScope]):
    """

    handle: Union[Unset, str] = UNSET
    model: Union[Unset, str] = UNSET
    temperature: Union[Unset, float] = UNSET
    max_tokens: Union[Unset, float] = UNSET
    commit_message: Union[Unset, str] = UNSET
    author_id: Union[Unset, str] = UNSET
    prompt: Union[Unset, str] = UNSET
    messages: Union[Unset, list["PutApiPromptsByIdBodyMessagesItem"]] = UNSET
    inputs: Union[Unset, list["PutApiPromptsByIdBodyInputsItem"]] = UNSET
    outputs: Union[Unset, list["PutApiPromptsByIdBodyOutputsItem"]] = UNSET
    schema_version: Union[Unset, PutApiPromptsByIdBodySchemaVersion] = UNSET
    scope: Union[Unset, PutApiPromptsByIdBodyScope] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        handle = self.handle

        model = self.model

        temperature = self.temperature

        max_tokens = self.max_tokens

        commit_message = self.commit_message

        author_id = self.author_id

        prompt = self.prompt

        messages: Union[Unset, list[dict[str, Any]]] = UNSET
        if not isinstance(self.messages, Unset):
            messages = []
            for messages_item_data in self.messages:
                messages_item = messages_item_data.to_dict()
                messages.append(messages_item)

        inputs: Union[Unset, list[dict[str, Any]]] = UNSET
        if not isinstance(self.inputs, Unset):
            inputs = []
            for inputs_item_data in self.inputs:
                inputs_item = inputs_item_data.to_dict()
                inputs.append(inputs_item)

        outputs: Union[Unset, list[dict[str, Any]]] = UNSET
        if not isinstance(self.outputs, Unset):
            outputs = []
            for outputs_item_data in self.outputs:
                outputs_item = outputs_item_data.to_dict()
                outputs.append(outputs_item)

        schema_version: Union[Unset, str] = UNSET
        if not isinstance(self.schema_version, Unset):
            schema_version = self.schema_version.value

        scope: Union[Unset, str] = UNSET
        if not isinstance(self.scope, Unset):
            scope = self.scope.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if handle is not UNSET:
            field_dict["handle"] = handle
        if model is not UNSET:
            field_dict["model"] = model
        if temperature is not UNSET:
            field_dict["temperature"] = temperature
        if max_tokens is not UNSET:
            field_dict["maxTokens"] = max_tokens
        if commit_message is not UNSET:
            field_dict["commitMessage"] = commit_message
        if author_id is not UNSET:
            field_dict["authorId"] = author_id
        if prompt is not UNSET:
            field_dict["prompt"] = prompt
        if messages is not UNSET:
            field_dict["messages"] = messages
        if inputs is not UNSET:
            field_dict["inputs"] = inputs
        if outputs is not UNSET:
            field_dict["outputs"] = outputs
        if schema_version is not UNSET:
            field_dict["schemaVersion"] = schema_version
        if scope is not UNSET:
            field_dict["scope"] = scope

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.put_api_prompts_by_id_body_inputs_item import PutApiPromptsByIdBodyInputsItem
        from ..models.put_api_prompts_by_id_body_messages_item import PutApiPromptsByIdBodyMessagesItem
        from ..models.put_api_prompts_by_id_body_outputs_item import PutApiPromptsByIdBodyOutputsItem

        d = dict(src_dict)
        handle = d.pop("handle", UNSET)

        model = d.pop("model", UNSET)

        temperature = d.pop("temperature", UNSET)

        max_tokens = d.pop("maxTokens", UNSET)

        commit_message = d.pop("commitMessage", UNSET)

        author_id = d.pop("authorId", UNSET)

        prompt = d.pop("prompt", UNSET)

        messages = []
        _messages = d.pop("messages", UNSET)
        for messages_item_data in _messages or []:
            messages_item = PutApiPromptsByIdBodyMessagesItem.from_dict(messages_item_data)

            messages.append(messages_item)

        inputs = []
        _inputs = d.pop("inputs", UNSET)
        for inputs_item_data in _inputs or []:
            inputs_item = PutApiPromptsByIdBodyInputsItem.from_dict(inputs_item_data)

            inputs.append(inputs_item)

        outputs = []
        _outputs = d.pop("outputs", UNSET)
        for outputs_item_data in _outputs or []:
            outputs_item = PutApiPromptsByIdBodyOutputsItem.from_dict(outputs_item_data)

            outputs.append(outputs_item)

        _schema_version = d.pop("schemaVersion", UNSET)
        schema_version: Union[Unset, PutApiPromptsByIdBodySchemaVersion]
        if isinstance(_schema_version, Unset):
            schema_version = UNSET
        else:
            schema_version = PutApiPromptsByIdBodySchemaVersion(_schema_version)

        _scope = d.pop("scope", UNSET)
        scope: Union[Unset, PutApiPromptsByIdBodyScope]
        if isinstance(_scope, Unset):
            scope = UNSET
        else:
            scope = PutApiPromptsByIdBodyScope(_scope)

        put_api_prompts_by_id_body = cls(
            handle=handle,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            commit_message=commit_message,
            author_id=author_id,
            prompt=prompt,
            messages=messages,
            inputs=inputs,
            outputs=outputs,
            schema_version=schema_version,
            scope=scope,
        )

        put_api_prompts_by_id_body.additional_properties = d
        return put_api_prompts_by_id_body

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
