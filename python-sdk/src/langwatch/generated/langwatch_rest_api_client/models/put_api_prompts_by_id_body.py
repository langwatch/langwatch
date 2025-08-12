from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define

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
        scope (Union[Unset, PutApiPromptsByIdBodyScope]):  Default: PutApiPromptsByIdBodyScope.PROJECT.
        author_id (Union[Unset, str]):
        prompt (Union[Unset, str]):
        messages (Union[Unset, list['PutApiPromptsByIdBodyMessagesItem']]):
        inputs (Union[Unset, list['PutApiPromptsByIdBodyInputsItem']]):
        outputs (Union[Unset, list['PutApiPromptsByIdBodyOutputsItem']]):
    """

    handle: Union[Unset, str] = UNSET
    scope: Union[Unset, PutApiPromptsByIdBodyScope] = PutApiPromptsByIdBodyScope.PROJECT
    author_id: Union[Unset, str] = UNSET
    prompt: Union[Unset, str] = UNSET
    messages: Union[Unset, list["PutApiPromptsByIdBodyMessagesItem"]] = UNSET
    inputs: Union[Unset, list["PutApiPromptsByIdBodyInputsItem"]] = UNSET
    outputs: Union[Unset, list["PutApiPromptsByIdBodyOutputsItem"]] = UNSET

    def to_dict(self) -> dict[str, Any]:
        handle = self.handle

        scope: Union[Unset, str] = UNSET
        if not isinstance(self.scope, Unset):
            scope = self.scope.value

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

        field_dict: dict[str, Any] = {}
        field_dict.update({})
        if handle is not UNSET:
            field_dict["handle"] = handle
        if scope is not UNSET:
            field_dict["scope"] = scope
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

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.put_api_prompts_by_id_body_inputs_item import PutApiPromptsByIdBodyInputsItem
        from ..models.put_api_prompts_by_id_body_messages_item import PutApiPromptsByIdBodyMessagesItem
        from ..models.put_api_prompts_by_id_body_outputs_item import PutApiPromptsByIdBodyOutputsItem

        d = dict(src_dict)
        handle = d.pop("handle", UNSET)

        _scope = d.pop("scope", UNSET)
        scope: Union[Unset, PutApiPromptsByIdBodyScope]
        if isinstance(_scope, Unset):
            scope = UNSET
        else:
            scope = PutApiPromptsByIdBodyScope(_scope)

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

        put_api_prompts_by_id_body = cls(
            handle=handle,
            scope=scope,
            author_id=author_id,
            prompt=prompt,
            messages=messages,
            inputs=inputs,
            outputs=outputs,
        )

        return put_api_prompts_by_id_body
