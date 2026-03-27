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
        outputs (list['PostApiPromptsByIdSyncBodyConfigDataOutputsItem']):
        model (str):
        messages (Union[Unset, list['PostApiPromptsByIdSyncBodyConfigDataMessagesItem']]):
        inputs (Union[Unset, list['PostApiPromptsByIdSyncBodyConfigDataInputsItem']]):
        temperature (Union[Unset, float]):
        max_tokens (Union[Unset, float]):
        top_p (Union[Unset, float]):
        frequency_penalty (Union[Unset, float]):
        presence_penalty (Union[Unset, float]):
        seed (Union[Unset, float]):
        top_k (Union[Unset, float]):
        min_p (Union[Unset, float]):
        repetition_penalty (Union[Unset, float]):
        reasoning (Union[Unset, str]):
        reasoning_effort (Union[Unset, str]):
        thinking_level (Union[Unset, str]):
        effort (Union[Unset, str]):
        verbosity (Union[Unset, str]):
        demonstrations (Union[Unset, PostApiPromptsByIdSyncBodyConfigDataDemonstrations]):
        prompting_technique (Union[Unset, PostApiPromptsByIdSyncBodyConfigDataPromptingTechnique]):
        response_format (Union[Unset, PostApiPromptsByIdSyncBodyConfigDataResponseFormat]):
    """

    prompt: str
    outputs: list["PostApiPromptsByIdSyncBodyConfigDataOutputsItem"]
    model: str
    messages: Union[Unset, list["PostApiPromptsByIdSyncBodyConfigDataMessagesItem"]] = UNSET
    inputs: Union[Unset, list["PostApiPromptsByIdSyncBodyConfigDataInputsItem"]] = UNSET
    temperature: Union[Unset, float] = UNSET
    max_tokens: Union[Unset, float] = UNSET
    top_p: Union[Unset, float] = UNSET
    frequency_penalty: Union[Unset, float] = UNSET
    presence_penalty: Union[Unset, float] = UNSET
    seed: Union[Unset, float] = UNSET
    top_k: Union[Unset, float] = UNSET
    min_p: Union[Unset, float] = UNSET
    repetition_penalty: Union[Unset, float] = UNSET
    reasoning: Union[Unset, str] = UNSET
    reasoning_effort: Union[Unset, str] = UNSET
    thinking_level: Union[Unset, str] = UNSET
    effort: Union[Unset, str] = UNSET
    verbosity: Union[Unset, str] = UNSET
    demonstrations: Union[Unset, "PostApiPromptsByIdSyncBodyConfigDataDemonstrations"] = UNSET
    prompting_technique: Union[Unset, "PostApiPromptsByIdSyncBodyConfigDataPromptingTechnique"] = UNSET
    response_format: Union[Unset, "PostApiPromptsByIdSyncBodyConfigDataResponseFormat"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        prompt = self.prompt

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

        inputs: Union[Unset, list[dict[str, Any]]] = UNSET
        if not isinstance(self.inputs, Unset):
            inputs = []
            for inputs_item_data in self.inputs:
                inputs_item = inputs_item_data.to_dict()
                inputs.append(inputs_item)

        temperature = self.temperature

        max_tokens = self.max_tokens

        top_p = self.top_p

        frequency_penalty = self.frequency_penalty

        presence_penalty = self.presence_penalty

        seed = self.seed

        top_k = self.top_k

        min_p = self.min_p

        repetition_penalty = self.repetition_penalty

        reasoning = self.reasoning

        reasoning_effort = self.reasoning_effort

        thinking_level = self.thinking_level

        effort = self.effort

        verbosity = self.verbosity

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
                "outputs": outputs,
                "model": model,
            }
        )
        if messages is not UNSET:
            field_dict["messages"] = messages
        if inputs is not UNSET:
            field_dict["inputs"] = inputs
        if temperature is not UNSET:
            field_dict["temperature"] = temperature
        if max_tokens is not UNSET:
            field_dict["max_tokens"] = max_tokens
        if top_p is not UNSET:
            field_dict["top_p"] = top_p
        if frequency_penalty is not UNSET:
            field_dict["frequency_penalty"] = frequency_penalty
        if presence_penalty is not UNSET:
            field_dict["presence_penalty"] = presence_penalty
        if seed is not UNSET:
            field_dict["seed"] = seed
        if top_k is not UNSET:
            field_dict["top_k"] = top_k
        if min_p is not UNSET:
            field_dict["min_p"] = min_p
        if repetition_penalty is not UNSET:
            field_dict["repetition_penalty"] = repetition_penalty
        if reasoning is not UNSET:
            field_dict["reasoning"] = reasoning
        if reasoning_effort is not UNSET:
            field_dict["reasoning_effort"] = reasoning_effort
        if thinking_level is not UNSET:
            field_dict["thinkingLevel"] = thinking_level
        if effort is not UNSET:
            field_dict["effort"] = effort
        if verbosity is not UNSET:
            field_dict["verbosity"] = verbosity
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

        inputs = []
        _inputs = d.pop("inputs", UNSET)
        for inputs_item_data in _inputs or []:
            inputs_item = PostApiPromptsByIdSyncBodyConfigDataInputsItem.from_dict(inputs_item_data)

            inputs.append(inputs_item)

        temperature = d.pop("temperature", UNSET)

        max_tokens = d.pop("max_tokens", UNSET)

        top_p = d.pop("top_p", UNSET)

        frequency_penalty = d.pop("frequency_penalty", UNSET)

        presence_penalty = d.pop("presence_penalty", UNSET)

        seed = d.pop("seed", UNSET)

        top_k = d.pop("top_k", UNSET)

        min_p = d.pop("min_p", UNSET)

        repetition_penalty = d.pop("repetition_penalty", UNSET)

        reasoning = d.pop("reasoning", UNSET)

        reasoning_effort = d.pop("reasoning_effort", UNSET)

        thinking_level = d.pop("thinkingLevel", UNSET)

        effort = d.pop("effort", UNSET)

        verbosity = d.pop("verbosity", UNSET)

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
            outputs=outputs,
            model=model,
            messages=messages,
            inputs=inputs,
            temperature=temperature,
            max_tokens=max_tokens,
            top_p=top_p,
            frequency_penalty=frequency_penalty,
            presence_penalty=presence_penalty,
            seed=seed,
            top_k=top_k,
            min_p=min_p,
            repetition_penalty=repetition_penalty,
            reasoning=reasoning,
            reasoning_effort=reasoning_effort,
            thinking_level=thinking_level,
            effort=effort,
            verbosity=verbosity,
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
