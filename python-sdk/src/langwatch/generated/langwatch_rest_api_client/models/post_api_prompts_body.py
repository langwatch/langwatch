from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

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
        scope (PostApiPromptsBodyScope | Unset):  Default: PostApiPromptsBodyScope.PROJECT.
        model (str | Unset):
        temperature (float | Unset):
        max_tokens (float | Unset):
        commit_message (str | Unset):
        author_id (str | Unset):
        prompt (str | Unset):
        messages (list[PostApiPromptsBodyMessagesItem] | Unset):
        inputs (list[PostApiPromptsBodyInputsItem] | Unset):
        outputs (list[PostApiPromptsBodyOutputsItem] | Unset):
        schema_version (PostApiPromptsBodySchemaVersion | Unset):
    """

    handle: str
    scope: PostApiPromptsBodyScope | Unset = PostApiPromptsBodyScope.PROJECT
    model: str | Unset = UNSET
    temperature: float | Unset = UNSET
    max_tokens: float | Unset = UNSET
    commit_message: str | Unset = UNSET
    author_id: str | Unset = UNSET
    prompt: str | Unset = UNSET
    messages: list[PostApiPromptsBodyMessagesItem] | Unset = UNSET
    inputs: list[PostApiPromptsBodyInputsItem] | Unset = UNSET
    outputs: list[PostApiPromptsBodyOutputsItem] | Unset = UNSET
    schema_version: PostApiPromptsBodySchemaVersion | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        handle = self.handle

        scope: str | Unset = UNSET
        if not isinstance(self.scope, Unset):
            scope = self.scope.value

        model = self.model

        temperature = self.temperature

        max_tokens = self.max_tokens

        commit_message = self.commit_message

        author_id = self.author_id

        prompt = self.prompt

        messages: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.messages, Unset):
            messages = []
            for messages_item_data in self.messages:
                messages_item = messages_item_data.to_dict()
                messages.append(messages_item)

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

        schema_version: str | Unset = UNSET
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
        scope: PostApiPromptsBodyScope | Unset
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

        _messages = d.pop("messages", UNSET)
        messages: list[PostApiPromptsBodyMessagesItem] | Unset = UNSET
        if _messages is not UNSET:
            messages = []
            for messages_item_data in _messages:
                messages_item = PostApiPromptsBodyMessagesItem.from_dict(messages_item_data)

                messages.append(messages_item)

        _inputs = d.pop("inputs", UNSET)
        inputs: list[PostApiPromptsBodyInputsItem] | Unset = UNSET
        if _inputs is not UNSET:
            inputs = []
            for inputs_item_data in _inputs:
                inputs_item = PostApiPromptsBodyInputsItem.from_dict(inputs_item_data)

                inputs.append(inputs_item)

        _outputs = d.pop("outputs", UNSET)
        outputs: list[PostApiPromptsBodyOutputsItem] | Unset = UNSET
        if _outputs is not UNSET:
            outputs = []
            for outputs_item_data in _outputs:
                outputs_item = PostApiPromptsBodyOutputsItem.from_dict(outputs_item_data)

                outputs.append(outputs_item)

        _schema_version = d.pop("schemaVersion", UNSET)
        schema_version: PostApiPromptsBodySchemaVersion | Unset
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
