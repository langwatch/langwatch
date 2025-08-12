from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_index_body_scope import PostIndexBodyScope
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_index_body_inputs_item import PostIndexBodyInputsItem
    from ..models.post_index_body_messages_item import PostIndexBodyMessagesItem
    from ..models.post_index_body_outputs_item import PostIndexBodyOutputsItem


T = TypeVar("T", bound="PostIndexBody")


@_attrs_define
class PostIndexBody:
    """
    Attributes:
        handle (str):
        scope (Union[Unset, PostIndexBodyScope]):  Default: PostIndexBodyScope.PROJECT.
        author_id (Union[Unset, str]):
        prompt (Union[Unset, str]):
        messages (Union[Unset, list['PostIndexBodyMessagesItem']]):
        inputs (Union[Unset, list['PostIndexBodyInputsItem']]):
        outputs (Union[Unset, list['PostIndexBodyOutputsItem']]):
    """

    handle: str
    scope: Union[Unset, PostIndexBodyScope] = PostIndexBodyScope.PROJECT
    author_id: Union[Unset, str] = UNSET
    prompt: Union[Unset, str] = UNSET
    messages: Union[Unset, list["PostIndexBodyMessagesItem"]] = UNSET
    inputs: Union[Unset, list["PostIndexBodyInputsItem"]] = UNSET
    outputs: Union[Unset, list["PostIndexBodyOutputsItem"]] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

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
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "handle": handle,
            }
        )
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
        from ..models.post_index_body_inputs_item import PostIndexBodyInputsItem
        from ..models.post_index_body_messages_item import PostIndexBodyMessagesItem
        from ..models.post_index_body_outputs_item import PostIndexBodyOutputsItem

        d = dict(src_dict)
        handle = d.pop("handle")

        _scope = d.pop("scope", UNSET)
        scope: Union[Unset, PostIndexBodyScope]
        if isinstance(_scope, Unset):
            scope = UNSET
        else:
            scope = PostIndexBodyScope(_scope)

        author_id = d.pop("authorId", UNSET)

        prompt = d.pop("prompt", UNSET)

        messages = []
        _messages = d.pop("messages", UNSET)
        for messages_item_data in _messages or []:
            messages_item = PostIndexBodyMessagesItem.from_dict(messages_item_data)

            messages.append(messages_item)

        inputs = []
        _inputs = d.pop("inputs", UNSET)
        for inputs_item_data in _inputs or []:
            inputs_item = PostIndexBodyInputsItem.from_dict(inputs_item_data)

            inputs.append(inputs_item)

        outputs = []
        _outputs = d.pop("outputs", UNSET)
        for outputs_item_data in _outputs or []:
            outputs_item = PostIndexBodyOutputsItem.from_dict(outputs_item_data)

            outputs.append(outputs_item)

        post_index_body = cls(
            handle=handle,
            scope=scope,
            author_id=author_id,
            prompt=prompt,
            messages=messages,
            inputs=inputs,
            outputs=outputs,
        )

        post_index_body.additional_properties = d
        return post_index_body

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
