from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define

from ..models.post_api_prompts_body_schema_version import PostApiPromptsBodySchemaVersion
from ..models.post_api_prompts_body_scope import PostApiPromptsBodyScope
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_prompts_body_inputs_item import PostApiPromptsBodyInputsItem
    from ..models.post_api_prompts_body_messages_item import PostApiPromptsBodyMessagesItem
    from ..models.post_api_prompts_body_outputs_item import PostApiPromptsBodyOutputsItem


T = TypeVar("T", bound="PostApiPromptsBody")


@_attrs_define
class PostApiPromptsBody:
    """
    Attributes:
        handle (str):
        scope (Union[Unset, PostApiPromptsBodyScope]):  Default: PostApiPromptsBodyScope.PROJECT.
        model (Union[Unset, str]):
        temperature (Union[Unset, float]):
        max_tokens (Union[Unset, float]):
        commit_message (Union[Unset, str]):
        author_id (Union[Unset, str]):
        prompt (Union[Unset, str]):
        messages (Union[Unset, list['PostApiPromptsBodyMessagesItem']]):
        inputs (Union[Unset, list['PostApiPromptsBodyInputsItem']]):
        outputs (Union[Unset, list['PostApiPromptsBodyOutputsItem']]):
        schema_version (Union[Unset, PostApiPromptsBodySchemaVersion]):
    """

    handle: str
    scope: Union[Unset, PostApiPromptsBodyScope] = PostApiPromptsBodyScope.PROJECT
    model: Union[Unset, str] = UNSET
    temperature: Union[Unset, float] = UNSET
    max_tokens: Union[Unset, float] = UNSET
    commit_message: Union[Unset, str] = UNSET
    author_id: Union[Unset, str] = UNSET
    prompt: Union[Unset, str] = UNSET
    messages: Union[Unset, list["PostApiPromptsBodyMessagesItem"]] = UNSET
    inputs: Union[Unset, list["PostApiPromptsBodyInputsItem"]] = UNSET
    outputs: Union[Unset, list["PostApiPromptsBodyOutputsItem"]] = UNSET
    schema_version: Union[Unset, PostApiPromptsBodySchemaVersion] = UNSET

    def to_dict(self) -> dict[str, Any]:
        handle = self.handle

        scope: Union[Unset, str] = UNSET
        if not isinstance(self.scope, Unset):
            scope = self.scope.value

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

        field_dict: dict[str, Any] = {}
        field_dict.update(
            {
                "handle": handle,
            }
        )
        if scope is not UNSET:
            field_dict["scope"] = scope
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

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_prompts_body_inputs_item import PostApiPromptsBodyInputsItem
        from ..models.post_api_prompts_body_messages_item import PostApiPromptsBodyMessagesItem
        from ..models.post_api_prompts_body_outputs_item import PostApiPromptsBodyOutputsItem

        d = dict(src_dict)
        handle = d.pop("handle")

        _scope = d.pop("scope", UNSET)
        scope: Union[Unset, PostApiPromptsBodyScope]
        if isinstance(_scope, Unset):
            scope = UNSET
        else:
            scope = PostApiPromptsBodyScope(_scope)

        model = d.pop("model", UNSET)

        temperature = d.pop("temperature", UNSET)

        max_tokens = d.pop("maxTokens", UNSET)

        commit_message = d.pop("commitMessage", UNSET)

        author_id = d.pop("authorId", UNSET)

        prompt = d.pop("prompt", UNSET)

        messages = []
        _messages = d.pop("messages", UNSET)
        for messages_item_data in _messages or []:
            messages_item = PostApiPromptsBodyMessagesItem.from_dict(messages_item_data)

            messages.append(messages_item)

        inputs = []
        _inputs = d.pop("inputs", UNSET)
        for inputs_item_data in _inputs or []:
            inputs_item = PostApiPromptsBodyInputsItem.from_dict(inputs_item_data)

            inputs.append(inputs_item)

        outputs = []
        _outputs = d.pop("outputs", UNSET)
        for outputs_item_data in _outputs or []:
            outputs_item = PostApiPromptsBodyOutputsItem.from_dict(outputs_item_data)

            outputs.append(outputs_item)

        _schema_version = d.pop("schemaVersion", UNSET)
        schema_version: Union[Unset, PostApiPromptsBodySchemaVersion]
        if isinstance(_schema_version, Unset):
            schema_version = UNSET
        else:
            schema_version = PostApiPromptsBodySchemaVersion(_schema_version)

        post_api_prompts_body = cls(
            handle=handle,
            scope=scope,
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
        )

        return post_api_prompts_body
