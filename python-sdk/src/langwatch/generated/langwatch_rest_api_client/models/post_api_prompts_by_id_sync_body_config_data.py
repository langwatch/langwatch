from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

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
        outputs (list[PostApiPromptsByIdSyncBodyConfigDataOutputsItem]):
        model (str):
        messages (list[PostApiPromptsByIdSyncBodyConfigDataMessagesItem] | Unset):
        inputs (list[PostApiPromptsByIdSyncBodyConfigDataInputsItem] | Unset):
        temperature (float | Unset):
        max_tokens (float | Unset):
        top_p (float | Unset):
        frequency_penalty (float | Unset):
        presence_penalty (float | Unset):
        seed (float | Unset):
        top_k (float | Unset):
        min_p (float | Unset):
        repetition_penalty (float | Unset):
        reasoning (str | Unset):
        reasoning_effort (str | Unset):
        thinking_level (str | Unset):
        effort (str | Unset):
        verbosity (str | Unset):
        demonstrations (PostApiPromptsByIdSyncBodyConfigDataDemonstrations | Unset):
        prompting_technique (PostApiPromptsByIdSyncBodyConfigDataPromptingTechnique | Unset):
        response_format (PostApiPromptsByIdSyncBodyConfigDataResponseFormat | Unset):
    """

    prompt: str
    outputs: list[PostApiPromptsByIdSyncBodyConfigDataOutputsItem]
    model: str
    messages: list[PostApiPromptsByIdSyncBodyConfigDataMessagesItem] | Unset = UNSET
    inputs: list[PostApiPromptsByIdSyncBodyConfigDataInputsItem] | Unset = UNSET
    temperature: float | Unset = UNSET
    max_tokens: float | Unset = UNSET
    top_p: float | Unset = UNSET
    frequency_penalty: float | Unset = UNSET
    presence_penalty: float | Unset = UNSET
    seed: float | Unset = UNSET
    top_k: float | Unset = UNSET
    min_p: float | Unset = UNSET
    repetition_penalty: float | Unset = UNSET
    reasoning: str | Unset = UNSET
    reasoning_effort: str | Unset = UNSET
    thinking_level: str | Unset = UNSET
    effort: str | Unset = UNSET
    verbosity: str | Unset = UNSET
    demonstrations: PostApiPromptsByIdSyncBodyConfigDataDemonstrations | Unset = UNSET
    prompting_technique: PostApiPromptsByIdSyncBodyConfigDataPromptingTechnique | Unset = UNSET
    response_format: PostApiPromptsByIdSyncBodyConfigDataResponseFormat | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        prompt = self.prompt

        outputs = []
        for outputs_item_data in self.outputs:
            outputs_item = outputs_item_data.to_dict()
            outputs.append(outputs_item)

        model = self.model

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

        demonstrations: dict[str, Any] | Unset = UNSET
        if not isinstance(self.demonstrations, Unset):
            demonstrations = self.demonstrations.to_dict()

        prompting_technique: dict[str, Any] | Unset = UNSET
        if not isinstance(self.prompting_technique, Unset):
            prompting_technique = self.prompting_technique.to_dict()

        response_format: dict[str, Any] | Unset = UNSET
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

        _messages = d.pop("messages", UNSET)
        messages: list[PostApiPromptsByIdSyncBodyConfigDataMessagesItem] | Unset = UNSET
        if _messages is not UNSET:
            messages = []
            for messages_item_data in _messages:
                messages_item = PostApiPromptsByIdSyncBodyConfigDataMessagesItem.from_dict(messages_item_data)

                messages.append(messages_item)

        _inputs = d.pop("inputs", UNSET)
        inputs: list[PostApiPromptsByIdSyncBodyConfigDataInputsItem] | Unset = UNSET
        if _inputs is not UNSET:
            inputs = []
            for inputs_item_data in _inputs:
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
        demonstrations: PostApiPromptsByIdSyncBodyConfigDataDemonstrations | Unset
        if isinstance(_demonstrations, Unset):
            demonstrations = UNSET
        else:
            demonstrations = PostApiPromptsByIdSyncBodyConfigDataDemonstrations.from_dict(_demonstrations)

        _prompting_technique = d.pop("prompting_technique", UNSET)
        prompting_technique: PostApiPromptsByIdSyncBodyConfigDataPromptingTechnique | Unset
        if isinstance(_prompting_technique, Unset):
            prompting_technique = UNSET
        else:
            prompting_technique = PostApiPromptsByIdSyncBodyConfigDataPromptingTechnique.from_dict(_prompting_technique)

        _response_format = d.pop("response_format", UNSET)
        response_format: PostApiPromptsByIdSyncBodyConfigDataResponseFormat | Unset
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
