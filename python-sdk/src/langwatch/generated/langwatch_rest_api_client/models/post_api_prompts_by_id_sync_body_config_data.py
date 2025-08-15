from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_prompts_by_id_sync_body_config_data_demonstrations import (
        PostApiPromptsByIdSyncBodyConfigDataDemonstrations,
    )
    from ..models.post_api_prompts_by_id_sync_body_config_data_inputs_item import (
        PostApiPromptsByIdSyncBodyConfigDataInputsItem,
    )
    from ..models.post_api_prompts_by_id_sync_body_config_data_messages_item import (
        PostApiPromptsByIdSyncBodyConfigDataMessagesItem,
    )
    from ..models.post_api_prompts_by_id_sync_body_config_data_outputs_item import (
        PostApiPromptsByIdSyncBodyConfigDataOutputsItem,
    )
    from ..models.post_api_prompts_by_id_sync_body_config_data_prompting_technique import (
        PostApiPromptsByIdSyncBodyConfigDataPromptingTechnique,
    )
    from ..models.post_api_prompts_by_id_sync_body_config_data_response_format import (
        PostApiPromptsByIdSyncBodyConfigDataResponseFormat,
    )


T = TypeVar("T", bound="PostApiPromptsByIdSyncBodyConfigData")


@_attrs_define
class PostApiPromptsByIdSyncBodyConfigData:
    """
    Attributes:
        prompt (str):
        inputs (list['PostApiPromptsByIdSyncBodyConfigDataInputsItem']):
        outputs (list['PostApiPromptsByIdSyncBodyConfigDataOutputsItem']):
        model (str):
        messages (Union[Unset, list['PostApiPromptsByIdSyncBodyConfigDataMessagesItem']]):
        temperature (Union[Unset, float]):
        max_tokens (Union[Unset, float]):
        demonstrations (Union[Unset, PostApiPromptsByIdSyncBodyConfigDataDemonstrations]):
        prompting_technique (Union[Unset, PostApiPromptsByIdSyncBodyConfigDataPromptingTechnique]):
        response_format (Union[Unset, PostApiPromptsByIdSyncBodyConfigDataResponseFormat]):
    """

    prompt: str
    inputs: list["PostApiPromptsByIdSyncBodyConfigDataInputsItem"]
    outputs: list["PostApiPromptsByIdSyncBodyConfigDataOutputsItem"]
    model: str
    messages: Union[Unset, list["PostApiPromptsByIdSyncBodyConfigDataMessagesItem"]] = UNSET
    temperature: Union[Unset, float] = UNSET
    max_tokens: Union[Unset, float] = UNSET
    demonstrations: Union[Unset, "PostApiPromptsByIdSyncBodyConfigDataDemonstrations"] = UNSET
    prompting_technique: Union[Unset, "PostApiPromptsByIdSyncBodyConfigDataPromptingTechnique"] = UNSET
    response_format: Union[Unset, "PostApiPromptsByIdSyncBodyConfigDataResponseFormat"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        prompt = self.prompt

        inputs = []
        for inputs_item_data in self.inputs:
            inputs_item = inputs_item_data.to_dict()
            inputs.append(inputs_item)

        outputs = []
        for outputs_item_data in self.outputs:
            outputs_item = outputs_item_data.to_dict()
            outputs.append(outputs_item)

        model = self.model

        messages: Union[Unset, list[dict[str, Any]]] = UNSET
        if not isinstance(self.messages, Unset):
            messages = []
            for messages_item_data in self.messages:
                messages_item = messages_item_data.to_dict()
                messages.append(messages_item)

        temperature = self.temperature

        max_tokens = self.max_tokens

        demonstrations: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.demonstrations, Unset):
            demonstrations = self.demonstrations.to_dict()

        prompting_technique: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.prompting_technique, Unset):
            prompting_technique = self.prompting_technique.to_dict()

        response_format: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.response_format, Unset):
            response_format = self.response_format.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "prompt": prompt,
                "inputs": inputs,
                "outputs": outputs,
                "model": model,
            }
        )
        if messages is not UNSET:
            field_dict["messages"] = messages
        if temperature is not UNSET:
            field_dict["temperature"] = temperature
        if max_tokens is not UNSET:
            field_dict["max_tokens"] = max_tokens
        if demonstrations is not UNSET:
            field_dict["demonstrations"] = demonstrations
        if prompting_technique is not UNSET:
            field_dict["prompting_technique"] = prompting_technique
        if response_format is not UNSET:
            field_dict["response_format"] = response_format

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_prompts_by_id_sync_body_config_data_demonstrations import (
            PostApiPromptsByIdSyncBodyConfigDataDemonstrations,
        )
        from ..models.post_api_prompts_by_id_sync_body_config_data_inputs_item import (
            PostApiPromptsByIdSyncBodyConfigDataInputsItem,
        )
        from ..models.post_api_prompts_by_id_sync_body_config_data_messages_item import (
            PostApiPromptsByIdSyncBodyConfigDataMessagesItem,
        )
        from ..models.post_api_prompts_by_id_sync_body_config_data_outputs_item import (
            PostApiPromptsByIdSyncBodyConfigDataOutputsItem,
        )
        from ..models.post_api_prompts_by_id_sync_body_config_data_prompting_technique import (
            PostApiPromptsByIdSyncBodyConfigDataPromptingTechnique,
        )
        from ..models.post_api_prompts_by_id_sync_body_config_data_response_format import (
            PostApiPromptsByIdSyncBodyConfigDataResponseFormat,
        )

        d = dict(src_dict)
        prompt = d.pop("prompt")

        inputs = []
        _inputs = d.pop("inputs")
        for inputs_item_data in _inputs:
            inputs_item = PostApiPromptsByIdSyncBodyConfigDataInputsItem.from_dict(inputs_item_data)

            inputs.append(inputs_item)

        outputs = []
        _outputs = d.pop("outputs")
        for outputs_item_data in _outputs:
            outputs_item = PostApiPromptsByIdSyncBodyConfigDataOutputsItem.from_dict(outputs_item_data)

            outputs.append(outputs_item)

        model = d.pop("model")

        messages = []
        _messages = d.pop("messages", UNSET)
        for messages_item_data in _messages or []:
            messages_item = PostApiPromptsByIdSyncBodyConfigDataMessagesItem.from_dict(messages_item_data)

            messages.append(messages_item)

        temperature = d.pop("temperature", UNSET)

        max_tokens = d.pop("max_tokens", UNSET)

        _demonstrations = d.pop("demonstrations", UNSET)
        demonstrations: Union[Unset, PostApiPromptsByIdSyncBodyConfigDataDemonstrations]
        if isinstance(_demonstrations, Unset):
            demonstrations = UNSET
        else:
            demonstrations = PostApiPromptsByIdSyncBodyConfigDataDemonstrations.from_dict(_demonstrations)

        _prompting_technique = d.pop("prompting_technique", UNSET)
        prompting_technique: Union[Unset, PostApiPromptsByIdSyncBodyConfigDataPromptingTechnique]
        if isinstance(_prompting_technique, Unset):
            prompting_technique = UNSET
        else:
            prompting_technique = PostApiPromptsByIdSyncBodyConfigDataPromptingTechnique.from_dict(_prompting_technique)

        _response_format = d.pop("response_format", UNSET)
        response_format: Union[Unset, PostApiPromptsByIdSyncBodyConfigDataResponseFormat]
        if isinstance(_response_format, Unset):
            response_format = UNSET
        else:
            response_format = PostApiPromptsByIdSyncBodyConfigDataResponseFormat.from_dict(_response_format)

        post_api_prompts_by_id_sync_body_config_data = cls(
            prompt=prompt,
            inputs=inputs,
            outputs=outputs,
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            demonstrations=demonstrations,
            prompting_technique=prompting_technique,
            response_format=response_format,
        )

        post_api_prompts_by_id_sync_body_config_data.additional_properties = d
        return post_api_prompts_by_id_sync_body_config_data

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
